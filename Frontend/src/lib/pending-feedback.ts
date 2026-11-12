/**
 * 감상 피드백을 언제 물을지: 해설을 끝까지 들으면 표시해 두고, 홈 화면으로 돌아왔을 때 한 번 꺼내 팝업을 띄운다.
 * 같은 작품은 앱을 켜 둔 동안 한 번만 묻는다(다시 들어도 또 묻지 않는다). 앱을 껐다 켜면 초기화된다.
 */

export type PendingFeedback = { artworkId: string; title: string };

let pending: PendingFeedback | null = null;
const asked = new Set<string>();

/** 해설 화면이 마지막 문장까지 들었을 때 부른다. 이미 물어본 작품이면 무시한다. */
export function markFeedbackPending(item: PendingFeedback) {
  if (!item.artworkId || asked.has(item.artworkId)) return;
  pending = item;
}

/** 홈 화면이 포커스를 받을 때 부른다. 꺼낸 작품은 다시 묻지 않는다. */
export function takePendingFeedback(): PendingFeedback | null {
  const next = pending;
  pending = null;
  if (next) asked.add(next.artworkId);
  return next;
}
