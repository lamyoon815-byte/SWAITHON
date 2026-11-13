/**
 * 감상 피드백을 언제 물을지: 해설을 끝까지 들으면 표시해 두고, 등록 작품은 홈에서, 미등록 감상은 해설 화면을 나왔을 때 한 번 묻는다.
 * 같은 작품은 앱을 켜 둔 동안 한 번만 묻는다(다시 들어도 또 묻지 않는다). 앱을 껐다 켜면 초기화된다.
 */

export type PendingFeedback = { title: string } & (
  { artworkId: string; analysisId?: never } | { artworkId: null; analysisId: string }
);

function feedbackKey(item: PendingFeedback) {
  return item.artworkId === null ? `analysis:${item.analysisId}` : `artwork:${item.artworkId}`;
}

let pending: PendingFeedback | null = null;
const asked = new Set<string>();

/** 해설 화면이 마지막 문장까지 들었을 때 부른다. 이미 물어본 작품이면 무시한다. */
export function markFeedbackPending(item: PendingFeedback) {
  if (!(item.artworkId || item.analysisId) || asked.has(feedbackKey(item))) return;
  pending = item;
}

/** 홈 또는 미등록 감상 종료 화면에서 부른다. source가 있으면 해당 종류만 꺼내며, 나머지는 보존한다. */
export function takePendingFeedback(source?: 'analysis'): PendingFeedback | null {
  if (source === 'analysis' && pending?.artworkId !== null) return null;
  const next = pending;
  pending = null;
  if (next) asked.add(feedbackKey(next));
  return next;
}
