/** 이름 변경 API가 제공되기 전까지 이 기기의 계정별 표시 이름만 보관한다. */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'momi:display-names:v1';
type Snapshot = { names: Record<string, string>; loaded: boolean; error: boolean };
let snapshot: Snapshot = { names: {}, loaded: false, error: false };
let loading: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function emit(next: Snapshot) { snapshot = next; listeners.forEach((listener) => listener()); }
function load() {
  loading ??= AsyncStorage.getItem(KEY).then((raw) => {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('잘못된 이름 저장 형식');
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(parsed)) {
      if (typeof name === 'string' && name.trim() && name.trim().length <= 40) names[id] = name.trim();
    }
    emit({ names, loaded: true, error: false });
  }).catch(() => emit({ names: {}, loaded: true, error: true }));
  return loading;
}

export const getDisplayNameSnapshot = () => snapshot;
export function subscribeDisplayName(listener: () => void) {
  listeners.add(listener); void load(); return () => { listeners.delete(listener); };
}
export async function reloadDisplayNames() { loading = null; await load(); }
export function saveDisplayName(userId: string, value: string) {
  const name = value.trim();
  if (!userId || !name || name.length > 40) return Promise.reject(new Error('이름은 1~40자로 입력해 주세요.'));
  const task = writing.then(async () => {
    await load();
    if (snapshot.error) throw new Error('저장된 이름을 불러오지 못했어요.');
    const names = { ...snapshot.names, [userId]: name };
    await AsyncStorage.setItem(KEY, JSON.stringify(names));
    emit({ names, loaded: true, error: false });
  });
  writing = task.catch(() => {});
  return task;
}
