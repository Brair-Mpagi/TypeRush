import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'typerush.preferences';

export interface Preferences {
  /** Suppresses ambient animation; see §14 — for this genre it is not optional polish. */
  reducedMotion: boolean;
  /** Mirrors the falling words into an ARIA live region for screen readers. */
  announceWords: boolean;
  /** Draws high-contrast text with no colour-only signalling. */
  highContrast: boolean;
}

function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function load(): Preferences {
  const defaults: Preferences = {
    reducedMotion: systemPrefersReducedMotion(),
    announceWords: false,
    highContrast: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Preferences>) } : defaults;
  } catch {
    return defaults;
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Storage can be unavailable (private mode); preferences are not worth failing over.
    }
    document.documentElement.dataset.contrast = preferences.highContrast ? 'high' : 'normal';
  }, [preferences]);

  // Follow the OS setting when the user has not overridden it in this session.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = () => setPreferences((p) => ({ ...p, reducedMotion: query.matches }));
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback((key: keyof Preferences) => {
    setPreferences((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  return { preferences, toggle };
}
