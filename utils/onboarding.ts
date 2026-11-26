import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, Vibration } from 'react-native';

const ONBOARDING_KEY = 'onboarding_seen';
const RECENT_SEARCHES_KEY = 'mono.recent_searches';
const onboardingListeners = new Set<(seen: boolean) => void>();

export const hasSeenOnboarding = async () => {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY);
  return value === '1';
};

export const markOnboardingSeen = async () => {
  await AsyncStorage.setItem(ONBOARDING_KEY, '1');
  onboardingListeners.forEach((listener) => listener(true));
};

export function subscribeOnboardingChanged(listener: (seen: boolean) => void): () => void {
  onboardingListeners.add(listener);
  return () => {
    onboardingListeners.delete(listener);
  };
}

export function triggerHaptic(durationMs = 10): void {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((reduced) => {
      if (!reduced) Vibration.vibrate(durationMs);
    })
    .catch(() => {
      Vibration.vibrate(durationMs);
    });
}

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

export async function addRecentSearch(query: string): Promise<string[]> {
  const clean = query.trim();
  if (!clean) return getRecentSearches();
  const prev = await getRecentSearches();
  const next = [clean, ...prev.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(
    0,
    4
  );
  await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
}
