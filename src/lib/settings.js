const SETTINGS_KEY = "rumb-settings-v1";
const ACTIVE_THEME_KEY = "rumb-theme-active-v1";
const MUSIC_SETTINGS_KEY = "rumb-music-settings-v1";
const SFX_SETTINGS_KEY = "rumb-sfx-settings-v1";
const LANGUAGE_KEY = "rumb-language-v1";

export const DEFAULT_SETTINGS = {
  theme: "default",
  language: "ca",
  musicEnabled: false,
  musicVolume: 0,
  musicTrack: "segadors",
  sfxEnabled: false,
  sfxVolume: 0
};

function coerceNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function coerceBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function coerceString(value, fallback) {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

export function loadSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return {
        theme: coerceString(parsed.theme, DEFAULT_SETTINGS.theme),
        language: coerceString(parsed.language, DEFAULT_SETTINGS.language),
        musicEnabled: coerceBoolean(parsed.musicEnabled, DEFAULT_SETTINGS.musicEnabled),
        musicVolume: coerceNumber(parsed.musicVolume, DEFAULT_SETTINGS.musicVolume),
        musicTrack: coerceString(parsed.musicTrack, DEFAULT_SETTINGS.musicTrack),
        sfxEnabled: coerceBoolean(parsed.sfxEnabled, DEFAULT_SETTINGS.sfxEnabled),
        sfxVolume: coerceNumber(parsed.sfxVolume, DEFAULT_SETTINGS.sfxVolume)
      };
    } catch {
      // continua amb migració.
    }
  }

  const theme = localStorage.getItem(ACTIVE_THEME_KEY) || DEFAULT_SETTINGS.theme;
  const language = localStorage.getItem(LANGUAGE_KEY) || DEFAULT_SETTINGS.language;
  let musicEnabled = DEFAULT_SETTINGS.musicEnabled;
  let musicVolume = DEFAULT_SETTINGS.musicVolume;
  let musicTrack = DEFAULT_SETTINGS.musicTrack;
  let sfxEnabled = DEFAULT_SETTINGS.sfxEnabled;
  let sfxVolume = DEFAULT_SETTINGS.sfxVolume;

  const musicRaw = localStorage.getItem(MUSIC_SETTINGS_KEY);
  if (musicRaw) {
    try {
      const parsed = JSON.parse(musicRaw);
      musicEnabled = coerceBoolean(parsed.enabled, musicEnabled);
      musicVolume = coerceNumber(parsed.volume, musicVolume);
      musicTrack = coerceString(parsed.track, musicTrack);
    } catch {
      // ignorem
    }
  }

  const sfxRaw = localStorage.getItem(SFX_SETTINGS_KEY);
  if (sfxRaw) {
    try {
      const parsed = JSON.parse(sfxRaw);
      sfxEnabled = coerceBoolean(parsed.enabled, sfxEnabled);
      sfxVolume = coerceNumber(parsed.volume, sfxVolume);
    } catch {
      // ignorem
    }
  }

  return {
    theme: coerceString(theme, DEFAULT_SETTINGS.theme),
    language: coerceString(language, DEFAULT_SETTINGS.language),
    musicEnabled,
    musicVolume,
    musicTrack,
    sfxEnabled,
    sfxVolume
  };
}

export function saveSettings(settings) {
  if (typeof window === "undefined") return;
  const payload = {
    theme: coerceString(settings.theme, DEFAULT_SETTINGS.theme),
    language: coerceString(settings.language, DEFAULT_SETTINGS.language),
    musicEnabled: coerceBoolean(settings.musicEnabled, DEFAULT_SETTINGS.musicEnabled),
    musicVolume: coerceNumber(settings.musicVolume, DEFAULT_SETTINGS.musicVolume),
    musicTrack: coerceString(settings.musicTrack, DEFAULT_SETTINGS.musicTrack),
    sfxEnabled: coerceBoolean(settings.sfxEnabled, DEFAULT_SETTINGS.sfxEnabled),
    sfxVolume: coerceNumber(settings.sfxVolume, DEFAULT_SETTINGS.sfxVolume)
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

export { SETTINGS_KEY };
