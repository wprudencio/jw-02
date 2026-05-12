/**
 * DrumMachine — 5-voice synthesized drum machine with 10 preset patterns.
 *
 * Sounds are generated entirely via Web Audio API (no samples):
 *   0  KICK    — sine oscillator with pitch envelope
 *   1  SNARE   — noise burst + triangle oscillator
 *   2  HI-HAT  — filtered noise, short decay (open/closed)
 *   3  CLAP    — layered noise bursts with micro-timing
 *   4  TOM     — sine oscillator with pitch envelope (higher than kick)
 *
 * Patterns are 16-step grids (4/4 at 16th note resolution).
 * Each pattern defines which sounds trigger on which steps.
 *
 * The drum machine uses the SynthEngine's AudioContext and routes
 * through the effects chain so drums get reverb, distortion, etc.
 */

const SOUNDS = ['KICK', 'SNARE', 'HI-HAT', 'CLAP', 'TOM'];
const STEPS = 16;

const PATTERN_NAMES = [
  'FOUR ON FLOOR',
  'BREAKBEAT',
  'HOUSE',
  'TECHNO',
  'HIP-HOP',
  'JUNGLE',
  'DEMBOX',
  'BOSSA NOVA',
  'INDUSTRIAL',
  '2-STEP',
];

// Bitfield patterns: each sound is an array of 16 booleans (step on/off)
// [kick, snare, hi-hat, clap, tom]
const PATTERNS = {
  'FOUR ON FLOOR': {
    kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    tom:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'BREAKBEAT': {
    kick:   [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    hihat:  [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,0],
    clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    tom:    [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
  },
  'HOUSE': {
    kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    hihat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    clap:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    tom:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'TECHNO': {
    kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    clap:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    tom:    [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
  },
  'HIP-HOP': {
    kick:   [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
    snare:  [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
    hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    tom:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
  },
  'JUNGLE': {
    kick:   [1,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat:  [1,0,1,1, 1,0,1,1, 1,0,1,1, 1,0,1,1],
    clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    tom:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
  },
  'DEMBOX': {
    kick:   [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    clap:   [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
    tom:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'BOSSA NOVA': {
    kick:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    snare:  [0,0,0,1, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    tom:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
  },
  'INDUSTRIAL': {
    kick:   [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,0,0],
    hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    clap:   [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1],
    tom:    [0,0,1,0, 0,0,0,0, 0,1,0,0, 0,0,0,1],
  },
  '2-STEP': {
    kick:   [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    clap:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    tom:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
};

// Sound synthesis parameters (deterministic per-hash)
const SOUND_DEFAULTS = {
  kick: {
    freq: 55,        // base frequency Hz
    pitchEnv: 0.8,    // pitch envelope range (octaves)
    pitchDecay: 0.12, // pitch envelope decay seconds
    ampDecay: 0.35,   // amplitude decay seconds
    gain: 0.85,
  },
  snare: {
    freq: 180,        // tone frequency
    toneGain: 0.3,    // mix of tone vs noise
    noiseGain: 0.5,   // noise level
    decay: 0.18,      // overall decay seconds
    hpfFreq: 1500,   // highpass on noise
    gain: 0.7,
  },
  hihat: {
    freq: 8000,       // biquad bandpass center
    Q: 1.5,           // resonance
    decay: 0.06,      // closed hihat decay
    gain: 0.35,
  },
  clap: {
    spacing: 0.015,   // seconds between micro-bursts
    count: 3,         // number of micro-bursts
    decay: 0.15,      // overall decay
    hpfFreq: 1200,    // high-pass on noise
    gain: 0.55,
  },
  tom: {
    freq: 120,        // base frequency (higher than kick)
    pitchEnv: 0.5,    // pitch envelope range
    pitchDecay: 0.08, // pitch envelope decay
    ampDecay: 0.22,   // amplitude decay
    gain: 0.65,
  },
};

export class DrumMachine {
  constructor(engine) {
    this._engine = engine;

    // State
    this._active = false;
    this._patternIdx = 0;
    this._bpm = 140;
    this._divisorKey = '1/16';

    // Custom grid: can be edited by user. Deep copy of current pattern.
    this._grid = this._deepCopyPattern(PATTERN_NAMES[0]);

    // Sequencer
    this._step = 0;
    this._timerId = null;
    this._nextStepTime = 0;

    // Sound params — start with defaults, can be mutated via hash
    this._soundParams = this._deepCopyDefaults();

    // Mixing
    this._muteState = { kick: false, snare: false, hihat: false, clap: false, tom: false };

    // Noise buffer (shared)
    this._noiseBuffer = null;
  }

  // ─── Getters ────────────────────────────────────────

  get active() { return this._active; }
  get pattern() { return this._patternIdx; }
  get patternName() { return PATTERN_NAMES[this._patternIdx]; }
  static get patternNames() { return [...PATTERN_NAMES]; }
  static get soundNames() { return [...SOUNDS]; }
  static get steps() { return STEPS; }
  get bpm() { return this._bpm; }
  get divisor() { return this._divisorKey; }
  get grid() { return this._grid; }
  get muteState() { return { ...this._muteState }; }

  // ─── Control ────────────────────────────────────────

  setActive(on) {
    this._active = !!on;
    if (!this._active) {
      this._stop();
    } else {
      this._start();
    }
  }

  setPattern(idx) {
    this._patternIdx = Math.max(0, Math.min(PATTERN_NAMES.length - 1, idx));
    this._grid = this._deepCopyPattern(PATTERN_NAMES[this._patternIdx]);
  }

  setBPM(bpm) {
    this._bpm = Math.max(40, Math.min(300, bpm));
  }

  setDivisorKey(key) {
    const DIVISORS = { '1/4': 1, '1/8': 2, '1/8T': 3, '1/16': 4, '1/16T': 6, '1/32': 8 };
    if (DIVISORS[key] !== undefined) {
      this._divisorKey = key;
    }
  }

  /** Toggle a grid cell. Returns new state. */
  toggleStep(sound, step) {
    if (!this._grid[sound] || step < 0 || step >= STEPS) return false;
    this._grid[sound][step] = this._grid[sound][step] ? 0 : 1;
    return !!this._grid[sound][step];
  }

  /** Set mute state for a sound. */
  setMute(sound, muted) {
    if (sound in this._muteState) {
      this._muteState[sound] = !!muted;
    }
  }

  /** Mute / unmute toggle. Returns new state. */
  toggleMute(sound) {
    if (sound in this._muteState) {
      this._muteState[sound] = !this._muteState[sound];
      return this._muteState[sound];
    }
    return false;
  }

  /** Get the current step index (for UI highlighting) */
  get currentStep() { return this._step; }

  // ─── Sequencer ──────────────────────────────────────

  _start() {
    if (this._timerId !== null) return;
    if (!this._engine._ctx) return;

    this._step = 0;
    this._nextStepTime = 0;
    this._tick();
  }

  _stop() {
    if (this._timerId !== null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    this._step = 0;
  }

  _tick() {
    if (!this._active) return;

    const ctx = this._engine._ctx;
    if (!ctx) return;

    const DIVISORS = { '1/4': 1, '1/8': 2, '1/8T': 3, '1/16': 4, '1/16T': 6, '1/32': 8 };
    const stepsPerBeat = DIVISORS[this._divisorKey] || 4;
    // For 16-step patterns, each step is a 16th note.
    // At 1/16 divisor: stepDuration = (60000/bpm) / 4 = one 16th note
    // At 1/8 divisor: we play 2 steps per beat, but still 16 steps per cycle = 8 beats
    // We always play 16 steps per cycle. Step duration = 16th note duration.
    const stepDuration = (60000 / this._bpm) / 4; // ms per 16th note

    const now = performance.now();
    if (this._nextStepTime === 0) {
      this._nextStepTime = now;
    }

    // Prevent drift
    if (this._nextStepTime < now - stepDuration * 4) {
      this._nextStepTime = now;
    }

    // Play current step
    this._playStep(this._step);

    // Advance
    this._step = (this._step + 1) % STEPS;

    // Schedule next tick
    this._nextStepTime += stepDuration;
    const delay = Math.max(1, this._nextStepTime - performance.now());
    this._timerId = setTimeout(() => this._tick(), delay);
  }

  _playStep(step) {
    for (const sound of SOUNDS) {
      if (this._grid[sound] && this._grid[sound][step] && !this._muteState[sound]) {
        this._triggerSound(sound);
      }
    }
  }

  // ─── Sound Synthesis ────────────────────────────────

  _getNoiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const ctx = this._engine._ctx;
    if (!ctx) return null;

    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this._noiseBuffer = buffer;
    return buffer;
  }

  _triggerSound(sound) {
    const ctx = this._engine._ctx;
    if (!ctx) return;

    const params = this._soundParams[sound];
    const destination = this._engine._effects ? this._engine._effects.input : this._engine._masterGain;
    if (!destination) return;

    switch (sound) {
      case 'kick':  this._playKick(ctx, destination, params); break;
      case 'snare': this._playSnare(ctx, destination, params); break;
      case 'hihat': this._playHihat(ctx, destination, params); break;
      case 'clap':  this._playClap(ctx, destination, params); break;
      case 'tom':   this._playTom(ctx, destination, params); break;
    }
  }

  _playKick(ctx, dest, p) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.freq * Math.pow(2, p.pitchEnv), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.freq), now + p.pitchDecay);

    gain.gain.setValueAtTime(p.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + p.ampDecay);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + p.ampDecay + 0.05);
  }

  _playSnare(ctx, dest, p) {
    const now = ctx.currentTime;

    // Tone component
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(p.freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.freq * 0.5), now + p.decay * 0.5);
    oscGain.gain.setValueAtTime(p.toneGain * p.gain, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + p.decay * 0.6);
    osc.connect(oscGain);
    oscGain.connect(dest);
    osc.start(now);
    osc.stop(now + p.decay + 0.05);

    // Noise component
    const noise = ctx.createBufferSource();
    noise.buffer = this._getNoiseBuffer();
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(p.hpfFreq, now);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(p.noiseGain * p.gain, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);
    noise.connect(hpf);
    hpf.connect(noiseGain);
    noiseGain.connect(dest);
    noise.start(now);
    noise.stop(now + p.decay + 0.05);
  }

  _playHihat(ctx, dest, p) {
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this._getNoiseBuffer();

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(p.freq, now);
    bpf.Q.setValueAtTime(p.Q, now);

    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(Math.max(20, p.freq * 0.5), now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(p.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);

    noise.connect(bpf);
    bpf.connect(hpf);
    hpf.connect(gain);
    gain.connect(dest);

    noise.start(now);
    noise.stop(now + p.decay + 0.05);
  }

  _playClap(ctx, dest, p) {
    const now = ctx.currentTime;

    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(p.hpfFreq, now);

    const gain = ctx.createGain();

    // Layered micro-bursts for clap texture
    for (let i = 0; i < p.count; i++) {
      const burst = ctx.createBufferSource();
      burst.buffer = this._getNoiseBuffer();

      const burstGain = ctx.createGain();
      const offset = i * p.spacing;
      burstGain.gain.setValueAtTime(0, now + offset);
      burstGain.gain.linearRampToValueAtTime(p.gain / p.count, now + offset + 0.003);
      burstGain.gain.linearRampToValueAtTime(0, now + offset + 0.02);

      burst.connect(hpf);
      hpf.connect(gain);
      gain.connect(dest);

      burst.start(now + offset);
      burst.stop(now + p.decay + offset + 0.05);
    }

    // Final tail
    gain.gain.setValueAtTime(p.gain, now + p.count * p.spacing);
    gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);
  }

  _playTom(ctx, dest, p) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.freq * Math.pow(2, p.pitchEnv), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.freq), now + p.pitchDecay);

    gain.gain.setValueAtTime(p.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + p.ampDecay);

    osc.connect(gain);
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + p.ampDecay + 0.05);
  }

  // ─── Mutable grid ──────────────────────────────────

  /** Set a custom grid (for external editing) */
  setGrid(grid) {
    this._grid = grid;
  }

  /** Reset grid to current preset pattern */
  resetGrid() {
    this._grid = this._deepCopyPattern(PATTERN_NAMES[this._patternIdx]);
  }

  // ─── Sound param mutation from hash ─────────────────

  /**
   * Mutate sound parameters deterministically from a seed.
   * Called when a new hash is loaded to add variation to drum sounds.
   */
  mutateFromSeed(seed) {
    // Simple deterministic mutation using a.mulberry32-like approach
    const rng = (() => {
      let s = seed >>> 0;
      return () => {
        let t = (s += 0x6d2b79f5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();

    // Kick: vary freq, pitch env, decay
    this._soundParams.kick.freq = 40 + rng() * 30;                     // 40–70 Hz
    this._soundParams.kick.pitchEnv = 0.5 + rng() * 0.8;               // 0.5–1.3 oct
    this._soundParams.kick.ampDecay = 0.2 + rng() * 0.3;                // 0.2–0.5s

    // Snare: vary tone freq, decay
    this._soundParams.snare.freq = 140 + rng() * 120;                  // 140–260 Hz
    this._soundParams.snare.decay = 0.1 + rng() * 0.15;                 // 0.1–0.25s

    // Hi-hat: vary freq, decay
    this._soundParams.hihat.freq = 5000 + rng() * 7000;                // 5k–12k Hz
    this._soundParams.hihat.decay = 0.03 + rng() * 0.06;               // 30–90ms

    // Clap: vary spacing, decay
    this._soundParams.clap.spacing = 0.01 + rng() * 0.02;              // 10–30ms
    this._soundParams.clap.decay = 0.08 + rng() * 0.12;                 // 80–200ms

    // Tom: vary freq
    this._soundParams.tom.freq = 80 + rng() * 80;                      // 80–160 Hz
    this._soundParams.tom.pitchEnv = 0.3 + rng() * 0.5;                 // 0.3–0.8
    this._soundParams.tom.ampDecay = 0.15 + rng() * 0.15;              // 0.15–0.3s
  }

  // ─── Deep copy helpers ──────────────────────────────

  _deepCopyPattern(name) {
    const src = PATTERNS[name];
    const copy = {};
    for (const key of SOUNDS) {
      copy[key] = [...src[key]];
    }
    return copy;
  }

  _deepCopyDefaults() {
    const copy = {};
    for (const key of SOUNDS) {
      copy[key] = { ...SOUND_DEFAULTS[key] };
    }
    return copy;
  }

  /** Clean up */
  dispose() {
    this._stop();
  }
}