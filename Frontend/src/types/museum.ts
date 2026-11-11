// GET /museums 응답.

export type Museum = {
  id: string;
  name: string;
  /** "서울 종로구" */
  area: string;
};

/** 1-0 미술관 선택 뒤 이어서 할 동작 (`/museum?next=`). */
export type MuseumNext = 'number' | 'list';
