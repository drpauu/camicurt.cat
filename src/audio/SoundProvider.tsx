import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SOUNDS, SoundKey } from "./sounds";

type PlayOptions = {
  volumeMul?: number;
  bypassCooldown?: boolean;
};

type SoundContextValue = {
  play: (key: SoundKey, opts?: PlayOptions) => void;
  setEnabled: (next: boolean) => void;
  enabled: boolean;
  masterVolume: number;
  setMasterVolume: (next: number) => void;
  sfxVolume: number;
  setSfxVolume: (next: number) => void;
};

const SOUND_SETTINGS_KEY = "rumb-sound-settings-v1";
const APP_SETTINGS_KEY = "rumb-settings-v1";
const POOL_SIZE = 3;
const BURST_WINDOW_MS = 600;
const BURST_LIMIT = 3;
const OUTCOME_DUCK_MS = 1200;
const DEFAULT_SOUND_SETTINGS = { enabled: false, masterVolume: 0, sfxVolume: 0 };

const SoundContext = createContext<SoundContextValue | null>(null);

function clampVolume(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(value, 1));
}

function loadSoundSettings() {
  if (typeof window === "undefined") {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
  const raw = localStorage.getItem(SOUND_SETTINGS_KEY);
  if (!raw) {
    const appRaw = localStorage.getItem(APP_SETTINGS_KEY);
    if (appRaw) {
      try {
        const parsed = JSON.parse(appRaw);
        const sfxVolume = clampVolume(parsed.sfxVolume, DEFAULT_SOUND_SETTINGS.sfxVolume);
        return {
          enabled:
            typeof parsed.sfxEnabled === "boolean"
              ? parsed.sfxEnabled
              : DEFAULT_SOUND_SETTINGS.enabled,
          masterVolume: sfxVolume,
          sfxVolume
        };
      } catch {
        return { ...DEFAULT_SOUND_SETTINGS };
      }
    }
    return { ...DEFAULT_SOUND_SETTINGS };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled:
        typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SOUND_SETTINGS.enabled,
      masterVolume: clampVolume(parsed.masterVolume, DEFAULT_SOUND_SETTINGS.masterVolume),
      sfxVolume: clampVolume(parsed.sfxVolume, DEFAULT_SOUND_SETTINGS.sfxVolume)
    };
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(() => loadSoundSettings(), []);
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [masterVolume, setMasterVolume] = useState<number>(initial.masterVolume);
  const [sfxVolume, setSfxVolume] = useState<number>(initial.sfxVolume);
  const poolsRef = useRef(new Map<SoundKey, HTMLAudioElement[]>());
  const poolIndexRef = useRef(new Map<SoundKey, number>());
  const lastPlayedRef = useRef(new Map<SoundKey, number>());
  const burstRef = useRef(new Map<SoundKey, number[]>());
  const unlockedRef = useRef(false);
  const blockAllUntilRef = useRef(0);
  const blockKeyRef = useRef<SoundKey | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify({
      enabled,
      masterVolume: clampVolume(masterVolume, 1),
      sfxVolume: clampVolume(sfxVolume, 1)
    });
    localStorage.setItem(SOUND_SETTINGS_KEY, payload);
  }, [enabled, masterVolume, sfxVolume]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = () => {
      unlockedRef.current = true;
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  const getPool = useCallback((key: SoundKey) => {
    const existing = poolsRef.current.get(key);
    if (existing) return existing;
    const config = SOUNDS[key];
    const pool = Array.from({ length: POOL_SIZE }, () => {
      const audio = new Audio(config.src);
      audio.preload = "auto";
      return audio;
    });
    poolsRef.current.set(key, pool);
    return pool;
  }, []);

  const play = useCallback(
    (key: SoundKey, opts: PlayOptions = {}) => {
      if (!enabled) return;
      if (!unlockedRef.current) return;
      const sound = SOUNDS[key];
      if (!sound) return;

      const now =
        typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      const blockUntil = blockAllUntilRef.current;
      if (blockUntil && now < blockUntil && blockKeyRef.current !== key) return;

      const lastPlayed = lastPlayedRef.current.get(key) || 0;
      if (!opts.bypassCooldown && now - lastPlayed < sound.cooldownMs) return;

      const burst = burstRef.current.get(key) || [];
      const nextBurst = burst.filter((stamp) => now - stamp < BURST_WINDOW_MS);
      if (nextBurst.length >= BURST_LIMIT) {
        burstRef.current.set(key, nextBurst);
        return;
      }
      nextBurst.push(now);
      burstRef.current.set(key, nextBurst);

      const volumeMul = typeof opts.volumeMul === "number" ? opts.volumeMul : 1;
      const finalVolume = Math.min(
        sound.baseVolume * sfxVolume * masterVolume * volumeMul,
        1
      );
      if (finalVolume <= 0) return;

      const pool = getPool(key);
      const index = poolIndexRef.current.get(key) || 0;
      const audio = pool[index];
      poolIndexRef.current.set(key, (index + 1) % pool.length);
      audio.volume = clampVolume(finalVolume, 1);
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }

      lastPlayedRef.current.set(key, now);

      if (sound.group === "outcome") {
        blockAllUntilRef.current = now + OUTCOME_DUCK_MS;
        blockKeyRef.current = key;
      }
    },
    [enabled, masterVolume, sfxVolume, getPool]
  );

  const value = useMemo(
    () => ({
      play,
      setEnabled,
      enabled,
      masterVolume,
      setMasterVolume,
      sfxVolume,
      setSfxVolume
    }),
    [play, enabled, masterVolume, sfxVolume]
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound() {
  const ctx = useContext(SoundContext);
  if (!ctx) {
    throw new Error("useSound must be used within SoundProvider");
  }
  return ctx;
}
