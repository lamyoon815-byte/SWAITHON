/**
 * 회원별 프로필 사진. BE에 사진 API가 없어 이 기기에만 저장한다(앱 문서 폴더에 복사, 회원 id별로 경로 기억).
 * 다른 폰에서 로그인하면 기본 이미지로 보인다. 화면은 `use-avatar` 훅을 쓴다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const KEY = 'swaithon:avatars:v1';

let snapshot: { avatars: Record<string, string>; loaded: boolean } = { avatars: {}, loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(avatars: Record<string, string>) {
  snapshot = { avatars, loaded: true };
  listeners.forEach((l) => l());
}

function load() {
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      emit(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {});
    })
    .catch(() => emit({}));
  return loading;
}

export const getAvatarSnapshot = () => snapshot;
export function subscribeAvatar(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => { listeners.delete(listener); };
}

function removeFile(uri: string | undefined) {
  if (!uri || Platform.OS === 'web') return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // 이미 지워졌으면 무시한다.
  }
}

async function save(next: Record<string, string>) {
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  emit(next);
}

/** 고른 사진(임시 파일)을 앱 문서 폴더로 옮겨 두고 그 회원의 프로필 사진으로 쓴다. */
export async function setAvatar(userId: string, pickedUri: string) {
  await load();
  let uri = pickedUri;
  if (Platform.OS !== 'web') {
    const dir = new Directory(Paths.document, 'avatars');
    if (!dir.exists) dir.create({ idempotent: true });
    // 매번 새 이름: 같은 경로면 expo-image가 예전 사진을 캐시에서 보여 준다.
    const target = new File(dir, `${userId.replace(/[^a-zA-Z0-9-]/g, '_')}-${Date.now()}.jpg`);
    await new File(pickedUri).copy(target);
    uri = target.uri;
  }
  removeFile(snapshot.avatars[userId]);
  await save({ ...snapshot.avatars, [userId]: uri });
}

export async function clearAvatar(userId: string) {
  await load();
  removeFile(snapshot.avatars[userId]);
  const { [userId]: _removed, ...rest } = snapshot.avatars;
  await save(rest);
}
