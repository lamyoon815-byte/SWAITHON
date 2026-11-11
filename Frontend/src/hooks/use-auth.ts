import { useSyncExternalStore } from 'react';

import { clearAvatar, getAuthSnapshot, setAvatar, signIn, signOut, signUp, subscribeAuth } from '@/store/auth';

/** `loaded`가 false인 동안은 저장된 세션을 아직 못 읽은 것이니 "로그인하기"를 먼저 그리지 않는다. */
export function useAuth() {
  const { session, avatar, loaded } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  return { user: session?.user ?? null, avatar, loaded, signIn, signUp, signOut, setAvatar, clearAvatar };
}
