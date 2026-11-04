"""AI 보정 함수의 입력 계약. 기존 앱 프로필과 단위를 자동 변환하지 않는다."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AIProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    # 사용자가 설정하기 전에는 검사 결과로 간주하지 않는다.
    color_type: Literal["normal", "protan", "deutan", "tritan"] = "normal"
    severity: float = Field(default=0, ge=0, le=1)
    contrast: float = Field(default=1, ge=0.5, le=2)
    brightness: float = Field(default=0, ge=-50, le=50)
    sharpness: float = Field(default=0, ge=0, le=2)
    edge: float = Field(default=0, ge=0, le=1)
