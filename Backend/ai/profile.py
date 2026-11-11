"""AI 보정 함수의 입력 계약. 기존 앱 프로필과 단위를 자동 변환하지 않는다."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

ColorSeverities = dict[Literal["protan", "deutan", "tritan"], Annotated[float, Field(ge=0, le=1)]]


class AIProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    # 사용자가 설정하기 전에는 검사 결과로 간주하지 않는다.
    color_type: Literal["normal", "protan", "deutan", "tritan"] = "normal"
    severity: float = Field(default=0, ge=0, le=1)
    color_severities: ColorSeverities | None = Field(default=None, exclude_if=lambda value: value is None)
    contrast: float = Field(default=1, ge=0.5, le=2)
    brightness: float = Field(default=0, ge=-50, le=50)
    sharpness: float = Field(default=0, ge=0, le=2)
    edge: float = Field(default=0, ge=0, le=1)

    def with_color_severities(self, previous: "AIProfile | None"):
        """새 종류를 저장할 때 이전 종류도 보존하고, 단일 종류의 옛 데이터는 그대로 읽는다."""
        if self.color_severities is None and (previous is None or (
            previous.color_severities is None and (previous.color_type == "normal" or previous.color_type == self.color_type)
        )):
            return self
        colors = {"protan": 0.0, "deutan": 0.0, "tritan": 0.0}
        if previous is not None:
            if previous.color_severities is not None:
                colors.update(previous.color_severities)
            elif previous.color_type != "normal":
                colors[previous.color_type] = previous.severity
        if self.color_severities is not None:
            colors.update(self.color_severities)
        elif self.color_type != "normal":
            colors[self.color_type] = self.severity
        return self.model_copy(update={
            "color_severities": colors,
            "severity": colors[self.color_type] if self.color_type != "normal" else 0,
        })
