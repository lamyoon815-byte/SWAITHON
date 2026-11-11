// BE `GET /artworks/{id}/narration` 응답 (README 6.2). 필드 이름은 BE 그대로 snake_case.
import type { Description } from '@/types/artwork';

export type NarrationMode = 'facts' | 'interpretations' | 'both';

/** brief = 간결하게(약 1분), detailed = 상세하게(약 3분) */
export type NarrationLength = 'brief' | 'detailed';

export type NarrationSegment = {
  type: 'fact' | 'interpretation';
  /** 화면과 음성에 그대로 쓰는 완결된 문장. 사실·해석 구분은 type을 사용한다. */
  text: string;
  /** 작품 상세 `description.regions`의 번호(0부터). null이면 영역을 강조하지 않는다. */
  region_index: number | null;
};

export type Narration = {
  artwork_id: string;
  mode: NarrationMode;
  segments: NarrationSegment[];
  /** segments를 줄바꿈으로 합친 것 */
  text: string;
  review_status: 'reviewed';
};

export type GeneratedNarration = Omit<Narration, 'review_status'> & {
  review_status: 'unreviewed';
  /** 서버가 함께 주는 AI 해설 원문. regions로 작품 위 영역 상자를 그린다 */
  description?: Description;
  warning: string;
  fallback: boolean;
  length?: NarrationLength;
  /** 공백 제외 글자 수 ÷ 5.5 */
  estimated_seconds?: number | null;
  /** 상세 해설의 근거 출처 */
  sources?: { no: number; title: string; url: string }[];
};
