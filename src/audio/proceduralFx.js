function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class ProceduralFxController {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 1;
  }

  ensureContext() {
    if (typeof window === "undefined") return null;
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = clamp(this.volume, 0, 1);
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  init() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
  }

  setEnabled(next) {
    this.enabled = Boolean(next);
  }

  setVolume(next) {
    this.volume = clamp(Number.isFinite(next) ? next : 1, 0, 1);
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
  }

  tone(
    frequency,
    duration,
    { type = "sine", volume = 0.12, slideTo = null, attack = 0.004, release = 0.12 } = {}
  ) {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    if (ctx.state !== "running") return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, frequency), now);
    if (typeof slideTo === "number") {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(30, slideTo),
        now + Math.max(0.01, duration)
      );
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + release + 0.02);
  }

  uiTap() {
    this.tone(860, 0.045, { type: "sine", volume: 0.07 });
  }

  mapTap() {
    this.tone(300, 0.06, { type: "triangle", volume: 0.055, slideTo: 240 });
  }

  wrong() {
    this.tone(185, 0.12, { type: "sawtooth", volume: 0.085, slideTo: 130 });
    setTimeout(() => this.tone(140, 0.1, { type: "sawtooth", volume: 0.06 }), 85);
  }

  near() {
    this.tone(530, 0.085, { type: "triangle", volume: 0.08, slideTo: 660 });
  }

  correct() {
    this.tone(680, 0.1, { type: "sine", volume: 0.1 });
    setTimeout(() => this.tone(990, 0.12, { type: "sine", volume: 0.08 }), 70);
  }

  combo() {
    this.tone(1120, 0.05, { type: "square", volume: 0.055 });
  }

  powerup() {
    this.tone(620, 0.08, { type: "triangle", volume: 0.08 });
    setTimeout(() => this.tone(930, 0.1, { type: "triangle", volume: 0.075 }), 55);
  }

  countdown(step = 3) {
    const n = Number.isFinite(step) ? step : 3;
    const freq = n <= 1 ? 980 : n === 2 ? 740 : 560;
    this.tone(freq, 0.09, { type: "square", volume: 0.07 });
  }

  complete(perfect = false) {
    const notes = perfect ? [440, 660, 880, 1100, 1320] : [380, 520, 680, 820];
    notes.forEach((freq, index) => {
      setTimeout(() => {
        this.tone(freq, 0.2, {
          type: "sine",
          volume: perfect ? 0.09 : 0.075
        });
      }, index * 120);
    });
  }
}

export function createProceduralFxController() {
  return new ProceduralFxController();
}
