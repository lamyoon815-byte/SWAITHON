import { useSyncExternalStore } from 'react';

import { clearAvatar, getAvatarSnapshot, setAvatar, subscribeAvatar } from '@/store/avatar';

/** 지금 회원의 프로필 사진 경로(없으면 null)와 바꾸기·지우기. */
export function useAvatar(userId: string | null | undefined) {
  const { avatars } = useSyncExternalStore(subscribeAvatar, getAvatarSnapshot, getAvatarSnapshot);
  return {
    avatar: userId ? avatars[userId] ?? null : null,
    setAvatar: (uri: string) => (userId ? setAvatar(userId, uri) : Promise.resolve()),
    clearAvatar: () => (userId ? clearAvatar(userId) : Promise.resolve()),
  };
}
