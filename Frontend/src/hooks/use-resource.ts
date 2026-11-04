import { useEffect, useState } from 'react';

type State<T> = { key: string; data?: T; error?: unknown };

/**
 * `lib/api.ts` 호출 결과를 들고 있는 작은 훅. `key`가 바뀌면 다시 부른다.
 * `key`가 null이면 부르지 않는다 (예: 미술관을 아직 고르지 않음).
 */
export function useResource<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<State<T> | null>(null);

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    load().then(
      (data) => alive && setState({ key, data }),
      (error) => alive && setState({ key, error }),
    );
    return () => {
      alive = false;
    };
    // `load` is recreated every render; `key` is what identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = state && state.key === key ? state : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: key !== null && !current,
  };
}
