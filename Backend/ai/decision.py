"""작품 인식 점수·작품 판별 결과·촬영 품질을 합쳐 앱이 다음에 할 일을 정한다.

next_action
- show_artwork: 등록 작품으로 확신 → 바로 작품 화면
- confirm_candidates: 후보를 보여 주고 사용자가 고르게 함
- analyze: 작품 사진이지만 등록 작품이 아님 → /analyze로 AI 해설 요청
- retake: 작품이 아닌 사진(손·바닥 등)이거나 알아볼 수 없음 → 다시 촬영 안내
"""
from typing import Literal

Reason = Literal["matched", "low_confidence", "unregistered_artwork", "not_artwork"]
NextAction = Literal["show_artwork", "confirm_candidates", "analyze", "retake"]

MESSAGES = {
    "show_artwork": "작품을 찾았어요.",
    "confirm_candidates": "비슷한 작품을 찾았어요. 찍은 작품이 맞는지 골라 주세요.",
    "analyze": "등록된 작품 목록에서는 찾지 못했어요. AI가 사진을 보고 작품을 설명해 드릴게요.",
    "retake": "작품을 인식하지 못했어요. 작품이 아닌 사진 같아요. 작품 전체가 화면 가운데에 오도록 다시 찍어 주세요.",
}


def decide(scores, *, match_threshold=None, high_threshold=None, artwork_probability=None,
           gate_threshold=None, quality_warnings=()):
    """scores: 후보 점수(내림차순). 반환: status, confidence, reason, next_action, message, keep_candidates."""
    top = scores[0] if scores else None
    gate_says_not_artwork = (artwork_probability is not None and gate_threshold is not None
                             and artwork_probability < gate_threshold)

    # 1) 등록 작품 기준을 넘으면 작품 판별 결과와 관계없이 등록 작품으로 본다.
    if top is not None and match_threshold is not None and top >= match_threshold:
        if high_threshold is not None and top >= high_threshold:
            return _result("matched", "high", "matched", "show_artwork", True)
        return _result("needs_confirmation", "medium", "matched", "confirm_candidates", True)

    # 2) 작품이 아닌 사진이면 다시 찍어 달라고 안내한다.
    if gate_says_not_artwork:
        result = _result("no_match", "low", "not_artwork", "retake", False)
        if quality_warnings:
            result["message"] += " " + " ".join(quality_warnings)
        return result

    # 3) 기준값을 아직 평가하지 않았으면 기존처럼 후보를 확인받는다.
    if match_threshold is None and top is not None:
        return _result("needs_confirmation", "medium", "low_confidence", "confirm_candidates", True)

    # 4) 작품 사진이지만 등록 작품과 충분히 비슷하지 않음 → AI 해설로 넘긴다.
    return _result("no_match", "low", "unregistered_artwork", "analyze", False)


def _result(status, confidence, reason, next_action, keep_candidates):
    return {"status": status, "confidence": confidence, "reason": reason, "next_action": next_action,
            "message": MESSAGES[next_action], "keep_candidates": keep_candidates}
