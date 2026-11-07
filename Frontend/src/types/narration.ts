// BE `GET /artworks/{id}/narration` 응답 (README 6.2). 필드 이름은 BE 그대로 snake_case.

export type NarrationMode = 'facts' | 'interpretations' | 'both';

export type NarrationSegment = {
  type: 'fact' | 'interpretation';
  /** 해석 문장은 BE가 앞에 "가능한 감정적 해석입니다."를 붙여 준다. FE에서 다시 붙이지 않는다. */
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
