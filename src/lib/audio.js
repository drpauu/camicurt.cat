const AUDIO_BASE = "/audio";

export async function loadAudioManifest() {
  const res = await fetch(`${AUDIO_BASE}/audio-manifest.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error("No s'ha pogut carregar l'audio-manifest.");
  const data = await res.json();
  return data;
}

export function createAudioManager(manifest = {}) {
  const sfxPools = new Map();
  const musicTracks = new Map();
  const activeSfxNodes = new Set();
  let currentMusic = null;
  let activeSfx = 0;
  const maxConcurrent = Number.isFinite(manifest.maxConcurrentSfx)
    ? manifest.maxConcurrentSfx
    : 8;

  function resolveAudioUrl(file) {
    return `${AUDIO_BASE}/${encodeURI(file)}`;
  }

  function getThemeConfig(themeId) {
    return (
      manifest.themes?.[themeId] ||
      manifest.themes?.default ||
      {}
    );
  }

  function clampVolume(value, fallback = 1) {
    const numeric =
      typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.max(0, Math.min(numeric, 1));
  }

  function buildPool(kind, themeId) {
    const theme = getThemeConfig(themeId);
    const list = theme.sfx?.[kind] || manifest.sfx?.[kind] || [];
    const pool = list.map((file) => {
      const audio = new Audio(resolveAudioUrl(file));
      audio.dataset.sfxKind = kind;
      audio.dataset.sfxFile = file;
      audio.preload = "auto";
      return audio;
    });
    sfxPools.set(`${themeId}:${kind}`, pool);
    return pool;
  }

  function playSfx(kind, themeId, volume = 0.6) {
    if (!kind) return;
    if (activeSfx >= maxConcurrent) return;
    const key = `${themeId}:${kind}`;
    const pool = sfxPools.get(key) || buildPool(kind, themeId);
    if (!pool.length) return;
    const theme = getThemeConfig(themeId);
    const rate = Number.isFinite(theme.rate) ? theme.rate : 1;
    const audio = pool[Math.floor(Math.random() * pool.length)].cloneNode(true);
    audio.volume = clampVolume(volume, 0.6);
    audio.playbackRate = rate;
    activeSfx += 1;
    activeSfxNodes.add(audio);
    const cleanup = () => {
      if (!activeSfxNodes.delete(audio)) return;
      activeSfx = Math.max(0, activeSfx - 1);
    };
    audio.addEventListener(
      "ended",
      cleanup,
      { once: true }
    );
    audio.play().catch(cleanup);
  }

  function playMusic(trackId, volume = 0.3, themeId = "default") {
    if (!trackId) return;
    const file = manifest.music?.[trackId];
    if (!file) return;
    const theme = getThemeConfig(themeId);
    const rate = Number.isFinite(theme.musicRate) ? theme.musicRate : theme.rate || 1;
    if (!musicTracks.has(trackId)) {
      const audio = new Audio(resolveAudioUrl(file));
      audio.loop = true;
      audio.preload = "auto";
      musicTracks.set(trackId, audio);
    }
    if (currentMusic && currentMusic !== trackId) {
      const prev = musicTracks.get(currentMusic);
      if (prev) {
        prev.pause();
        prev.currentTime = 0;
      }
    }
    const audio = musicTracks.get(trackId);
    if (!audio) return;
    audio.volume = clampVolume(volume, 0.3);
    audio.playbackRate = rate;
    const playPromise = audio.play();
    currentMusic = trackId;
    return playPromise;
  }

  function stopMusic() {
    if (!currentMusic) return;
    const audio = musicTracks.get(currentMusic);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    currentMusic = null;
  }

  function setMusicVolume(volume) {
    if (!currentMusic) return;
    const audio = musicTracks.get(currentMusic);
    if (!audio) return;
    audio.volume = clampVolume(volume, 0.3);
  }

  function setSfxVolume(volume) {
    if (!activeSfxNodes.size) return;
    const clamped = clampVolume(volume, 0.6);
    activeSfxNodes.forEach((audio) => {
      audio.volume = clamped;
    });
  }

  function preload(themeId = "default", kinds = []) {
    const requested = kinds.length ? kinds : Object.keys(manifest.sfx || {});
    requested.forEach((kind) => buildPool(kind, themeId));
  }

  return {
    playSfx,
    playMusic,
    stopMusic,
    setMusicVolume,
    setSfxVolume,
    preload
  };
}
