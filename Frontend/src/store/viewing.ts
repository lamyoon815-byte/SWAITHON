import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_VIEWING, normalizeViewing, type ViewingProfile } from '@/lib/calibration';

const KEY = 'swaithon.viewing.v1';
let snapshot = { values: DEFAULT_VIEWING, completed: false, loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const getViewingSnapshot = () => snapshot;
function emit() { listeners.forEach((listener) => listener()); }
function load() {
  loading ??= AsyncStorage.getItem(KEY).then((raw) => {
    const saved = raw ? JSON.parse(raw) : null;
    snapshot = { values: normalizeViewing(saved?.values ?? {}), completed: saved?.completed === true, loaded: true };
    emit();
  }).catch(() => { snapshot = { ...snapshot, loaded: true }; emit(); });
  return loading;
}
export function subscribeViewing(listener: () => void) {
  listeners.add(listener); void load();
  return () => { listeners.delete(listener); };
}
export async function saveViewing(values: ViewingProfile) {
  await load();
  const next = { values: normalizeViewing(values), completed: true, loaded: true };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  snapshot = next;
  emit();
}
