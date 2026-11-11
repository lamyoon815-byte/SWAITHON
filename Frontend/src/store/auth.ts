/**
 * 로그인 세션과 프로필 사진. 화면은 이 파일을 직접 쓰지 않고 `use-auth` 훅을 쓴다.
 * - 토큰·회원 정보: 기기 보안 저장소(expo-secure-store). 웹은 보안 저장소가 없어 AsyncStorage에 둔다.
 * - 프로필 사진: BE에 사진 API가 없어 이 기기에만 저장한다(앱 문서 폴더에 복사, 회원별로 경로 기억).
 *   다른 폰에서 로그인하면 기본 이미지로 보인다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { login as apiLogin, logout as apiLogout, register as apiRegister } from '@/lib/api';
import type { Session } from '@/types/auth';

const SESSION_KEY = 'swaithon.session.v1';
const AVATAR_KEY = 'swaithon:avatars:v1';

type Snapshot = { session: Session | null; avatar: string | null; loaded: boolean };

let snapshot: Snapshot = { session: null, avatar: null, loaded: false };
let avatars: Record<string, string> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const storage = Platform.OS === 'web'
  ? { get: (k: string) => AsyncStorage.getItem(k), set: (k: string, v: string) => AsyncStorage.setItem(k, v), remove: (k: string) => AsyncStorage.removeItem(k) }
  : { get: (k: string) => SecureStore.getItemAsync(k), set: (k: string, v: string) => SecureStore.setItemAsync(k, v), remove: (k: string) => SecureStore.deleteItemAsync(k) };

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

function avatarFor(session: Session | null) {
  return session ? avatars[session.user.id] ?? null : null;
}

function load() {
  loading ??= (async () => {
    try {
      avatars = JSON.parse((await AsyncStorage.getItem(AVATAR_KEY)) ?? '{}') as Record<string, string>;
    } catch {
      avatars = {};
    }
    let session: Session | null = null;
    try {
      const raw = await storage.get(SESSION_KEY);
      session = raw ? (JSON.parse(raw) as Session) : null;
      if (session && session.expires_at <= Date.now()) {
        session = null;
        await storage.remove(SESSION_KEY);
      }
    } catch {
      session = null;
    }
    emit({ session, avatar: avatarFor(session), loaded: true });
  })();
  return loading;
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => { listeners.delete(listener); };
}

export function getAuthSnapshot() {
  return snapshot;
}

async function start(session: Session) {
  await storage.set(SESSION_KEY, JSON.stringify(session));
  emit({ session, avatar: avatarFor(session), loaded: true });
}

export async function signIn(email: string, password: string) {
  await load();
  await start(await apiLogin(email.trim().toLowerCase(), password));
}

export async function signUp(email: string, password: string, nickname: string) {
  await load();
  await start(await apiRegister(email.trim().toLowerCase(), password, nickname.trim()));
}

export async function signOut() {
  await load();
  const token = snapshot.session?.token;
  await storage.remove(SESSION_KEY);
  emit({ session: null, avatar: null });
  if (token) await apiLogout(token);
}

async function saveAvatars() {
  await AsyncStorage.setItem(AVATAR_KEY, JSON.stringify(avatars));
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

/** 고른 사진(임시 파일)을 앱 문서 폴더로 옮겨 두고 지금 회원의 프로필 사진으로 쓴다. */
export async function setAvatar(pickedUri: string) {
  await load();
  const user = snapshot.session?.user;
  if (!user) return;
  let uri = pickedUri;
  if (Platform.OS !== 'web') {
    const dir = new Directory(Paths.document, 'avatars');
    if (!dir.exists) dir.create({ idempotent: true });
    // 매번 새 이름: 같은 경로면 expo-image가 예전 사진을 캐시에서 보여 준다.
    const target = new File(dir, `${user.id.replace(/[^a-zA-Z0-9-]/g, '_')}-${Date.now()}.jpg`);
    await new File(pickedUri).copy(target);
    uri = target.uri;
  }
  removeFile(avatars[user.id]);
  avatars = { ...avatars, [user.id]: uri };
  await saveAvatars();
  emit({ avatar: uri });
}

export async function clearAvatar() {
  await load();
  const user = snapshot.session?.user;
  if (!user) return;
  removeFile(avatars[user.id]);
  const { [user.id]: _removed, ...rest } = avatars;
  avatars = rest;
  await saveAvatars();
  emit({ avatar: null });
}
