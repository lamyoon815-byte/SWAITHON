// BE `ArtworkDetail`와 같은 모양 (README 6.1). 필드 이름은 BE 그대로 snake_case.

export type Region = {
  label: string;
  /** [x, y, width, height], 원본 이미지 대비 0~1, 왼쪽 위 기준 */
  bbox: [number, number, number, number];
  color: string;
};

export type Description = {
  facts: string[];
  interpretations: string[];
  regions: Region[];
  mood_keywords: string[];
};

export type Artwork = {
  id: string;
  title: string;
  artist: string;
  year: string | null;
  background: string | null;
  source_url: string | null;
  license: string | null;
  /** 사람이 검수하기 전에는 null */
  description: Description | null;
  review_status: 'pending' | 'reviewed';
  /** 백엔드가 제공하는 고화질 원본 URL */
  image_url: string;
  /** 미술관별 작품 번호 */
  number: string;
  /** 소속 미술관 ID */
  museum_id: string;
};
