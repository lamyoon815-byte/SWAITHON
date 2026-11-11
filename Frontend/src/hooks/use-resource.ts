import { useEffect, useState } from 'react';

type State<T> = { key: string; data?: T; error?: unknown };

/**
 * `lib/api.ts` 호출 결과를 들고 있는 작은 훅. `key`가 바뀌거나 `reload()`를 부르면 다시 부른다.
 * `key`가 null이면 부르지 않는다 (예: 미술관을 아직 고르지 않음).
 */
export function useResource<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<State<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = key === null ? null : `${key}#${attempt}`;

  useEffect(() => {
    if (requestKey === null) return;
    let alive = true;
    load().then(
      (data) => alive && setState({ key: requestKey, data }),
      (error) => alive && setState({ key: requestKey, error }),
    );
    return () => {
      alive = false;
    };
    // `load` is recreated every render; `requestKey` is what identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const current = state && state.key === requestKey ? state : null;
  const previous = state && state.key !== requestKey ? state : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: requestKey !== null && !current,
    /** 키가 바뀌어 새 요청을 기다리는 동안 직전 화면을 유지하고 싶을 때만 사용한다. */
    previousData: previous?.data,
    previousKey: previous?.key,
    reload: () => setAttempt((n) => n + 1),
  };
}
