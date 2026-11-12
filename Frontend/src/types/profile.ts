// BE `VisualProfile`와 같은 모양 (README 6.4, docs/api-spec.md 4장). 필드 이름은 BE 그대로 snake_case.
import type { CalibrationSettings } from '@/types/calibration';
import type { NarrationFocus, NarrationLength } from '@/types/narration';

export type VisualProfile = {
  color_vision: 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  /** 0~1 */
  color_severity: number;
  /** 0~1, 원본 대비 보정 강도 */
  strength: number;
  /** 0.5~2, 1 = 그대로 */
  contrast: number;
  /** -1~1, 0 = 그대로 */
  brightness: number;
  /** 0~2, 0 = 그대로 */
  sharpen: number;
  /** 1~8 */
  zoom: number;
  narration_mode: 'facts' | 'interpretations' | 'both';
  /** 해설 화면이 처음 고르는 길이 */
  narration_length: NarrationLength;
  /** AI 간결 해설의 초점 */
  narration_focus: NarrationFocus;
  /** 0.75~1.5 */
  speech_rate: number;
  high_contrast: boolean;
  /** 계정 DB에 앱 설정과 함께 저장하는 검사 결과. */
  calibration?: CalibrationSettings;
  /** DB 프로필 버전. 저장 충돌 및 다른 강도로 생성된 이미지 재사용을 막는다. */
  revision?: string;
};

/** CorrectionCanvas가 쓰는 값만. 프로필을 그대로 넘겨도 된다. */
export type CorrectionValues = Pick<
  VisualProfile,
  'contrast' | 'brightness' | 'sharpen' | 'strength'
>;

/** 마이페이지에서 함께 편집·저장하는 값. AI 강도와 Skia 단위를 섞지 않는다. */
export type ViewingSettings = Pick<VisualProfile, 'contrast' | 'brightness' | 'sharpen'> & CalibrationSettings;

/** BE 기본값과 같다. 진단 전이거나 프로필을 못 받았을 때 쓴다. */
export const DEFAULT_PROFILE: VisualProfile = {
  color_vision: 'normal',
  color_severity: 0,
  strength: 1,
  contrast: 1,
  brightness: 0,
  sharpen: 0,
  zoom: 1,
  narration_mode: 'both',
  narration_length: 'brief',
  narration_focus: 'balanced',
  speech_rate: 1,
  high_contrast: false,
};
