import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { LoginResult, Session, User } from '@/types/auth';

const KEY = 'swaithon.session.v1';
let snapshot: { session: Session | null; loaded: boolean } = { session: null, loaded: false };
let loading: Promise<void> | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const storage = {
  get: async () => Platform.OS === 'web'
    ? (typeof window !== 'undefined' ? window.sessionStorage.getItem(KEY) : null)
    : SecureStore.getItemAsync(KEY),
  set: async (value: string) => {
    if (Platform.OS === 'web') window.sessionStorage.setItem(KEY, value);
    else await SecureStore.setItemAsync(KEY, value);
  },
  remove: async () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.sessionStorage.removeItem(KEY);
    } else await SecureStore.deleteItemAsync(KEY);
  },
};

function emit(session: Session | null) {
  clearTimeout(expiry);
  snapshot = { session, loaded: true };
  if (session) expiry = setTimeout(() => { void clearSession(); }, Math.max(0, session.expiresAt - Date.now()));
  listeners.forEach((listener) => listener());
}

function load() {
  loading ??= storage.get().then(async (raw) => {
    const value = raw ? JSON.parse(raw) as Session : null;
    if (typeof value?.token === 'string' && typeof value.user?.id === 'string' && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now()) emit(value);
    else {
      if (raw) await storage.remove();
      emit(null);
    }
  }).catch(() => emit(null));
  return loading;
}

export const getAuthSnapshot = () => snapshot;
export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => { listeners.delete(listener); };
}

export function getAccessToken() {
  return snapshot.session && snapshot.session.expiresAt > Date.now() ? snapshot.session.token : null;
}

export async function saveSession(result: LoginResult) {
  await load();
  const session = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000, user: result.user };
  await storage.set(JSON.stringify(session));
  emit(session);
}

/** 이름을 바꾸거나 서버의 최신 회원 정보를 받았을 때 저장된 세션의 회원 정보만 바꾼다. 같으면 아무것도 하지 않는다. */
export async function updateSessionUser(user: User) {
  await load();
  const session = snapshot.session;
  if (!session || session.user.id !== user.id) return;
  if (session.user.nickname === user.nickname && session.user.email === user.email) return;
  const next = { ...session, user };
  await storage.set(JSON.stringify(next));
  emit(next);
}

export async function clearSession() {
  await load();
  // Clear the persisted credential before reporting a successful logout.
  try { await storage.remove(); }
  finally { emit(null); }
}
