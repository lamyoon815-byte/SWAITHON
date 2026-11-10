import type { NarrationMode } from '@/types/narration';

export const NARRATION_OPTIONS: { value: NarrationMode; label: string; description: string }[] = [
  { value: 'facts', label: '객관적 설명', description: '작품에 보이는 인물, 사물, 색과 구도를 설명해요.' },
  { value: 'interpretations', label: '감정적 해석', description: '작품에서 느낄 수 있는 감정과 분위기를 설명해요.' },
  { value: 'both', label: '둘 다 듣기', description: '객관적 설명에 이어 감정적 해석을 설명해요.' },
];
