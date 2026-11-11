"""Gemini 유료 API 사용 금액이 예산을 넘지 않도록 막는다.

- 호출 전: '지금까지 쓴 금액 + 진행 중인 호출의 예약 금액 + 이번 호출의 최대 비용'이 예산을 넘으면 호출하지 않는다.
  예약(reserve)한 금액은 응답 후 record()로 실제 금액으로 바꾸거나, 청구되지 않은 실패면 release()로 돌려준다.
  동시에 들어온 요청들이 같은 잔액을 보고 모두 통과하는 것을 막는다.
- 호출 후: 응답의 usageMetadata(실제 토큰 수)로 사용 금액을 기록한다.
- 예약 금액은 서버 프로세스 메모리에만 둔다(서버는 worker 1개로 실행). 서버를 여러 대 띄우면 상한도 서버마다 따로 적용된다.
금액은 환경변수의 단가·환율로 계산한 추정치다. 실제 청구액은 Google AI Studio 결제 화면에서 확인한다.
"""
from datetime import date
import json
import os
from pathlib import Path
from threading import Lock

from fastapi import HTTPException


def _env_float(name, default):
    value = os.environ.get(name, "").strip()
    return float(value) if value else default


class GeminiBudget:
    def __init__(self, path: Path, *, budget_krw=None, input_usd_per_m=None, output_usd_per_m=None,
                 krw_per_usd=None, max_input_tokens=None, max_output_tokens=4096, daily_limit=None):
        self.path = Path(path)
        # 기본값: 예산 12,000원, gemini-3.1-flash-lite 표준 단가(입력 $0.25, 출력 $1.50 / 100만 토큰),
        # 환율은 넉넉하게 1,500원으로 잡는다. 모델·단가가 바뀌면 .env에서 바꾼다.
        self.budget_krw = budget_krw if budget_krw is not None else _env_float("GEMINI_BUDGET_KRW", 12000)
        self.input_usd_per_m = input_usd_per_m if input_usd_per_m is not None else _env_float("GEMINI_INPUT_USD_PER_M", 0.25)
        self.output_usd_per_m = output_usd_per_m if output_usd_per_m is not None else _env_float("GEMINI_OUTPUT_USD_PER_M", 1.50)
        self.krw_per_usd = krw_per_usd if krw_per_usd is not None else _env_float("GEMINI_KRW_PER_USD", 1500)
        self.max_input_tokens = max_input_tokens if max_input_tokens is not None else _env_float("GEMINI_MAX_INPUT_TOKENS", 4000)
        self.max_output_tokens = max_output_tokens
        self.daily_limit = daily_limit if daily_limit is not None else int(_env_float("GEMINI_DAILY_LIMIT", 300))
        values = (self.budget_krw, self.input_usd_per_m, self.output_usd_per_m, self.krw_per_usd, self.max_input_tokens)
        if min(values) < 0 or self.daily_limit < 0:
            raise ValueError("Gemini 예산 설정은 0 이상이어야 합니다.")
        self.lock = Lock()
        self.pending_krw = 0.0  # 응답을 아직 기록하지 않은 호출들의 예약 금액

    def cost_krw(self, input_tokens, output_tokens):
        usd = input_tokens / 1e6 * self.input_usd_per_m + output_tokens / 1e6 * self.output_usd_per_m
        return usd * self.krw_per_usd

    @property
    def worst_case_call_krw(self):
        return self.cost_krw(self.max_input_tokens, self.max_output_tokens)

    def _read(self):
        try:
            state = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        state.setdefault("spent_krw", 0.0)
        state.setdefault("calls", 0)
        if state.get("day") != date.today().isoformat():
            state["day"], state["calls_today"] = date.today().isoformat(), 0
        return state

    def _write(self, state):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)

    def reserve(self):
        """호출 직전에 부른다. 예산이나 하루 횟수를 넘으면 429를 낸다. 통과하면 최대 비용을 예약한다.
        reserve()마다 record() 또는 release()를 정확히 한 번 불러야 한다."""
        with self.lock:
            state = self._read()
            if state["spent_krw"] + self.pending_krw + self.worst_case_call_krw > self.budget_krw:
                raise HTTPException(429, "AI 해설에 쓸 수 있는 예산을 모두 사용했어요. 등록된 작품 해설은 계속 들을 수 있어요.")
            if self.daily_limit and state["calls_today"] >= self.daily_limit:
                raise HTTPException(429, "오늘 AI 해설 사용 횟수를 모두 사용했어요. 내일 다시 이용해 주세요.")
            state["calls_today"] += 1
            state["calls"] += 1
            self._write(state)
            self.pending_krw += self.worst_case_call_krw

    def release(self):
        """응답을 받지 못해 청구되지 않은 호출(연결 실패, HTTP 오류)의 예약을 돌려준다."""
        with self.lock:
            self.pending_krw = max(0.0, self.pending_krw - self.worst_case_call_krw)

    def record(self, usage: dict | None):
        """응답의 usageMetadata로 실제 사용 금액을 더하고 예약을 푼다. 값이 없으면 최대 비용으로 보수적으로 기록한다."""
        with self.lock:
            self.pending_krw = max(0.0, self.pending_krw - self.worst_case_call_krw)
            state = self._read()
            if usage:
                input_tokens = int(usage.get("promptTokenCount") or 0)
                output_tokens = int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)
                cost = self.cost_krw(input_tokens, output_tokens)
            else:
                cost = self.worst_case_call_krw
            state["spent_krw"] = round(state["spent_krw"] + cost, 4)
            self._write(state)
            return cost

    def summary(self):
        with self.lock:
            state = self._read()
            pending = self.pending_krw
        return {"spent_krw": round(state["spent_krw"], 1), "pending_krw": round(pending, 1), "budget_krw": self.budget_krw,
                "calls": state["calls"], "calls_today": state["calls_today"], "daily_limit": self.daily_limit}
