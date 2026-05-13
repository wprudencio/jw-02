/**
 * SynthEngine — Main orchestrator.
 *
 * Responsibilities:
 *   - Manage AudioContext lifecycle
 *   - Generate complete synth configurations from a hash (deterministic)
 *   - Manage polyphonic voices (allocate/release)
 *   - Forward note on/off to voices
 *   - Host the global effects chain
 *
 * Parameter generation uses deterministic seeded randomness so that
 * the same hash always produces the exact same configuration.
 *
 * kkox0-inspired archetype system:
 *   Each hash selects a patch archetype (digital piano, pad, bass, etc.)
 *   then generates parameters within that archetype's musical constraints.
 *   This ensures distinct, professional-sounding patches rather than
 *   generic random tones.
 */
import { DeterministicRandom } from './DeterministicRandom.js';
import { Voice } from './Voice.js';
import { Effects } from './Effects.js';
import { Arpeggiator } from './Arpeggiator.js';

// ═══════════════════════════════════════════════════════════════════════
// kkox0-inspired Archetype Definitions
// Each archetype constrains parameters to produce musically coherent,
// professional-sounding patches rather than random mishmashes.
// ═══════════════════════════════════════════════════════════════════════
const ARCHETYPES = {
  digital_piano: {
    weight: 3,
    oscCount: [2, 3],
    envelope: { a: [0.001, 0.01], d: [0.4, 1.2], s: [0.25, 0.5], r: [0.3, 0.9] },
    filter: { type: 'lowpass', cutoff: [2500, 8000], Q: [0.5, 2.5], envAmount: [0.3, 0.6], envDecay: [0.3, 0.8], sustain: [0.5, 0.8] },
    voiceGain: [0.45, 0.55],
  },
  lush_pad: {
    weight: 3,
    oscCount: [3, 4],
    envelope: { a: [0.4, 2.5], d: [0.5, 2.0], s: [0.6, 0.85], r: [1.2, 4.5] },
    filter: { type: 'lowpass', cutoff: [800, 3500], Q: [1, 4], envAmount: [0.2, 0.5], envDecay: [0.8, 2.0], sustain: [0.6, 0.9] },
    voiceGain: [0.38, 0.48],
  },
  synth_bass: {
    weight: 3,
    oscCount: [2, 3],
    envelope: { a: [0.001, 0.008], d: [0.1, 0.4], s: [0.2, 0.55], r: [0.08, 0.3] },
    filter: { type: 'lowpass', cutoff: [250, 1200], Q: [2, 7], envAmount: [0.4, 0.9], envDecay: [0.15, 0.5], sustain: [0.3, 0.6] },
    voiceGain: [0.5, 0.6],
  },
  brass: {
    weight: 2,
    oscCount: [2, 3],
    envelope: { a: [0.008, 0.04], d: [0.15, 0.45], s: [0.45, 0.7], r: [0.15, 0.5] },
    filter: { type: 'lowpass', cutoff: [1200, 4500], Q: [1, 3.5], envAmount: [0.35, 0.7], envDecay: [0.2, 0.6], sustain: [0.5, 0.75] },
    voiceGain: [0.45, 0.55],
  },
  bell_mallet: {
    weight: 2,
    oscCount: [2, 3],
    envelope: { a: [0.001, 0.005], d: [0.8, 2.5], s: [0.0, 0.12], r: [1.0, 4.0] },
    filter: { type: 'lowpass', cutoff: [5000, 15000], Q: [0.3, 1.5], envAmount: [0.1, 0.3], envDecay: [0.5, 1.5], sustain: [0.3, 0.6] },
    voiceGain: [0.4, 0.52],
  },
  organ: {
    weight: 2,
    oscCount: [3, 4],
    envelope: { a: [0.001, 0.005], d: [0.01, 0.05], s: [0.8, 1.0], r: [0.03, 0.12] },
    filter: { type: 'lowpass', cutoff: [4000, 12000], Q: [0.3, 1.5], envAmount: [0.0, 0.15], envDecay: [0.05, 0.15], sustain: [0.9, 1.0] },
    voiceGain: [0.32, 0.42],
  },
  strings_ensemble: {
    weight: 2,
    oscCount: [3, 4],
    envelope: { a: [0.3, 1.5], d: [0.4, 1.0], s: [0.6, 0.82], r: [0.8, 2.5] },
    filter: { type: 'lowpass', cutoff: [2500, 7000], Q: [0.5, 2], envAmount: [0.1, 0.35], envDecay: [0.5, 1.2], sustain: [0.65, 0.85] },
    voiceGain: [0.38, 0.48],
  },
  synth_lead: {
    weight: 2,
    oscCount: [2, 3],
    envelope: { a: [0.001, 0.03], d: [0.08, 0.35], s: [0.5, 0.8], r: [0.15, 0.6] },
    filter: { type: 'lowpass', cutoff: [2500, 9000], Q: [1.5, 5], envAmount: [0.3, 0.7], envDecay: [0.15, 0.5], sustain: [0.5, 0.75] },
    voiceGain: [0.45, 0.58],
  },
  pluck: {
    weight: 2,
    oscCount: [1, 2],
    envelope: { a: [0.001, 0.003], d: [0.15, 0.6], s: [0.0, 0.08], r: [0.15, 0.5] },
    filter: { type: 'lowpass', cutoff: [3000, 10000], Q: [0.5, 2.5], envAmount: [0.5, 1.0], envDecay: [0.1, 0.35], sustain: [0.2, 0.5] },
    voiceGain: [0.45, 0.55],
  },
  fx_texture: {
    weight: 1,
    oscCount: [2, 4],
    envelope: { a: [0.001, 1.5], d: [0.1, 2.0], s: [0.0, 0.7], r: [0.2, 4.0] },
    filter: { type: null, cutoff: [200, 15000], Q: [0, 8], envAmount: [-0.5, 0.8], envDecay: [0.1, 1.5], sustain: [0.2, 0.8] },
    voiceGain: [0.3, 0.5],
  },
};

export class SynthEngine {
  /** Maximum polyphony */
  static MAX_VOICES = 16;

  constructor() {
    this._ctx = null;
    this._initialized = false;
    this._voices = [];
    this._voicePool = []; // free voice indices
    this._activeNotes = new Map(); // midiNote -> voice index
    this._effects = null;
    this._currentHash = '';
    this._currentConfig = null;
    this._rng = new DeterministicRandom(0);
    this._masterGain = null;
    this._sustainOn = false;
    this._sustainedVoices = new Set();

    // Arpeggiator
    this._arp = new Arpeggiator(this);
  }

  /** Whether the audio context has been initialized */
  get initialized() { return this._initialized; }

  /** Get the current hash */
  get currentHash() { return this._currentHash; }

  /** Get the current config (read-only) */
  get currentConfig() { return this._currentConfig; }

  /** Get the arpeggiator instance */
  get arp() { return this._arp; }

  /**
   * Initialize the audio context.
   * Must be called from a user gesture.
   */
  async init() {
    if (this._initialized) return;

    this._ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 44100,
    });

    // Master gain
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.setValueAtTime(0.7, this._ctx.currentTime);
    this._masterGain.connect(this._ctx.destination);

    // Build effects chain
    this._effects = new Effects(this._ctx);
    this._effects.connect(this._masterGain);

    // Initialize voice pool
    this._voicePool = [];
    this._voices = [];
    this._activeNotes = new Map();
    this._sustainOn = false;
    this._sustainedVoices = new Set();

    this._initialized = true;
  }

  /**
   * Set master volume (0–1).
   */
  setVolume(vol) {
    if (this._masterGain) {
      const now = this._ctx.currentTime;
      this._masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, vol)), now);
    }
  }

  /**
   * Sustain pedal pressed.
   */
  sustainOn() {
    this._sustainOn = true;
  }

  /**
   * Sustain pedal released — trigger release for all sustained voices.
   */
  sustainOff() {
    this._sustainOn = false;
    for (const voiceIdx of this._sustainedVoices) {
      const voice = this._voices[voiceIdx];
      if (voice) {
        voice.stop();
        const capturedVoice = voice;
        const capturedIdx = voiceIdx;
        const releaseTime = (this._currentConfig?.envelope?.r || 0.3) + 0.1;
        setTimeout(() => {
          capturedVoice.dispose();
          if (this._voices[capturedIdx] === capturedVoice) {
            this._voices[capturedIdx] = null;
            this._voicePool.push(capturedIdx);
          }
        }, releaseTime * 1000);
      }
    }
    this._sustainedVoices.clear();
  }

  /**
   * Resume audio context (required after auto-suspend on some browsers).
   */
  async resume() {
    if (this._ctx && this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }
  }

  /**
   * Generate a new random hash and build a synth configuration from it.
   * Returns the hash string.
   */
  generate() {
    const hash = DeterministicRandom.generateHash();
    this.loadHash(hash);
    return hash;
  }

  /**
   * Load a specific hash and build its synth configuration.
   */
  loadHash(hash) {
    if (!this._initialized) {
      console.warn('SynthEngine not initialized');
      return;
    }

    const cleanHash = hash.trim().toUpperCase();
    const seed = DeterministicRandom.hashToSeed(cleanHash);
    this._rng.reseed(seed);

    // Stop all active notes
    this.allNotesOff();

    // Generate configuration
    this._currentConfig = this._generateConfig();
    this._currentHash = cleanHash;

    // Update effects
    this._effects.setConfig(this._currentConfig.effects || null);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG GENERATION — kkox0 Archetype System
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate a complete synth configuration using the seeded RNG.
   * Selects a kkox0-inspired archetype first, then generates
   * parameters within that archetype's musical constraints.
   */
  _generateConfig() {
    const rng = this._rng;

    // ─── Pick Archetype ───
    const archetype = rng.weightedPick(
      Object.entries(ARCHETYPES).map(([name, def]) => ({ value: name, weight: def.weight }))
    );

    const oscCount = rng.nextInt(...ARCHETYPES[archetype].oscCount);
    const oscillators = this._buildOscillators(archetype, oscCount, rng);
    const envelope = this._buildEnvelope(archetype, rng);
    const filterConf = this._buildFilter(archetype, rng);
    const lfos = this._buildLFOs(archetype, rng);
    const effects = this._buildEffects(archetype, rng);
    const voiceGainRange = ARCHETYPES[archetype].voiceGain || [0.4, 0.5];
    const voiceGain = rng.nextFloat(...voiceGainRange);

    return {
      archetype,
      oscillators,
      envelope,
      ...filterConf,
      lfos,
      voiceGain,
      effects,
      _noiseSeed: rng.nextInt(1, 999999),
      _noiseType: rng.weightedPick([
        { value: 'white', weight: 3 },
        { value: 'pink', weight: 4 },
        { value: 'brown', weight: 2 },
      ]),
    };
  }

  // ─── Oscillator Builder ───────────────────────────────────────────

  _buildOscillators(archetype, count, rng) {
    const oscillators = [];

    for (let i = 0; i < count; i++) {
      const slot = this._oscSlotConfig(archetype, i, count, rng);
      const oscConf = this._buildSingleOsc(slot, rng);
      oscillators.push(oscConf);
    }

    return oscillators;
  }

  /**
   * Determine oscillator type, pitch offset, and gain for a given slot
   * based on the archetype. Returns a descriptor that _buildSingleOsc
   * will expand into a full oscillator config.
   */
  _oscSlotConfig(archetype, slotIdx, totalCount, rng) {
    switch (archetype) {
      case 'digital_piano': {
        // Slot 0: main body, Slot 1: brightness layer (+1 oct), Slot 2: sub
        if (slotIdx === 0) return { typePool: [{ value: 'wavetable', weight: 5 }, { value: 'sawtooth', weight: 3 }, { value: 'fm', weight: 2 }], pitch: [{ value: 1, weight: 8 }], gain: [0.3, 0.45], detune: [0, 4], wavetableProfile: ['piano', 'sawish', 'warm'] };
        if (slotIdx === 1) return { typePool: [{ value: 'sawtooth', weight: 4 }, { value: 'wavetable', weight: 3 }, { value: 'triangle', weight: 2 }], pitch: [{ value: 2, weight: 6 }, { value: 3, weight: 2 }], gain: [0.15, 0.25], detune: [0, 5], wavetableProfile: ['bright', 'sawish'] };
        return { typePool: [{ value: 'sine', weight: 6 }, { value: 'triangle', weight: 3 }], pitch: [{ value: 0.5, weight: 8 }], gain: [0.1, 0.2], detune: [0, 2] };
      }
      case 'lush_pad': {
        // Slot 0: supersaw body, Slot 1: detuned layer, Slot 2: harmonic, Slot 3: sub
        if (slotIdx === 0) return { typePool: [{ value: 'supersaw', weight: 6 }, { value: 'sawtooth', weight: 3 }], pitch: [{ value: 1, weight: 8 }], gain: [0.2, 0.35], detune: [0, 6], wavetableProfile: ['warm'] };
        if (slotIdx === 1) return { typePool: [{ value: 'sawtooth', weight: 5 }, { value: 'wavetable', weight: 4 }], pitch: [{ value: 1, weight: 8 }], gain: [0.15, 0.28], detune: [8, 22], wavetableProfile: ['warm', 'sawish'] };
        if (slotIdx === 2) return { typePool: [{ value: 'wavetable', weight: 5 }, { value: 'triangle', weight: 3 }, { value: 'sine', weight: 2 }], pitch: [{ value: 2, weight: 5 }, { value: 1, weight: 3 }], gain: [0.1, 0.2], detune: [0, 10], wavetableProfile: ['warm', 'formant'] };
        return { typePool: [{ value: 'sine', weight: 6 }, { value: 'triangle', weight: 3 }], pitch: [{ value: 0.5, weight: 7 }, { value: 1, weight: 3 }], gain: [0.08, 0.15], detune: [0, 3] };
      }
      case 'synth_bass': {
        // Slot 0: main osc, Slot 1: sub, Slot 2: thin upper layer
        if (slotIdx === 0) return { typePool: [{ value: 'square', weight: 5 }, { value: 'sawtooth', weight: 4 }, { value: 'pwm', weight: 3 }, { value: 'wavetable', weight: 2 }], pitch: [{ value: 1, weight: 8 }], gain: [0.35, 0.5], detune: [0, 3], wavetableProfile: ['bass', 'sawish'] };
        if (slotIdx === 1) return { typePool: [{ value: 'sine', weight: 7 }, { value: 'triangle', weight: 3 }], pitch: [{ value: 0.5, weight: 9 }], gain: [0.25, 0.4], detune: [0, 2] };
        return { typePool: [{ value: 'square', weight: 5 }, { value: 'sawtooth', weight: 3 }], pitch: [{ value: 2, weight: 5 }, { value: 3, weight: 2 }], gain: [0.08, 0.15], detune: [0, 5] };
      }
      case 'brass': {
        // Slot 0: main saw, Slot 1: detuned saw, Slot 2: upper harmonic
        if (slotIdx === 0) return { typePool: [{ value: 'sawtooth', weight: 8 }, { value: 'wavetable', weight: 3 }], pitch: [{ value: 1, weight: 8 }], gain: [0.3, 0.45], detune: [0, 3], wavetableProfile: ['brass', 'sawish'] };
        if (slotIdx === 1) return { typePool: [{ value: 'sawtooth', weight: 7 }, { value: 'square', weight: 3 }], pitch: [{ value: 1, weight: 8 }], gain: [0.2, 0.35], detune: [7, 18], wavetableProfile: ['brass'] };
        return { typePool: [{ value: 'sawtooth', weight: 5 }, { value: 'square', weight: 3 }, { value: 'wavetable', weight: 2 }], pitch: [{ value: 2, weight: 5 }, { value: 1, weight: 2 }], gain: [0.08, 0.18], detune: [0, 6], wavetableProfile: ['brass', 'bright'] };
      }
      case 'bell_mallet': {
        // Slot 0: FM pair, Slot 1: FM or wavetable layer, Slot 2: optional sub
        if (slotIdx === 0) return { typePool: [{ value: 'fm', weight: 7 }, { value: 'wavetable', weight: 3 }], pitch: [{ value: 1, weight: 8 }], gain: [0.35, 0.5], detune: [0, 3], wavetableProfile: ['bell', 'metallic'] };
        if (slotIdx === 1) return { typePool: [{ value: 'fm', weight: 5 }, { value: 'wavetable', weight: 4 }], pitch: [{ value: 2, weight: 4 }, { value: 3, weight: 3 }, { value: 1.5, weight: 2 }], gain: [0.15, 0.3], detune: [0, 8], wavetableProfile: ['bell', 'metallic'] };
        return { typePool: [{ value: 'sine', weight: 5 }, { value: 'triangle', weight: 3 }], pitch: [{ value: 0.5, weight: 6 }, { value: 1, weight: 3 }], gain: [0.05, 0.12], detune: [0, 2] };
      }
      case 'organ': {
        // Drawbar-style: fundamental, 2nd harmonic, 3rd harmonic, sub
        if (slotIdx === 0) return { typePool: [{ value: 'wavetable', weight: 6 }, { value: 'sine', weight: 3 }, { value: 'sawtooth', weight: 2 }], pitch: [{ value: 1, weight: 8 }], gain: [0.3, 0.45], detune: [0, 2], wavetableProfile: ['organ', 'sawish'] };
        if (slotIdx === 1) return { typePool: [{ value: 'wavetable', weight: 5 }, { value: 'sine', weight: 4 }], pitch: [{ value: 2, weight: 6 }, { value: 3, weight: 3 }], gain: [0.15, 0.28], detune: [0, 2], wavetableProfile: ['organ', 'formant'] };
        if (slotIdx === 2) return { typePool: [{ value: 'sine', weight: 6 }, { value: 'wavetable', weight: 3 }], pitch: [{ value: 3, weight: 5 }, { value: 4, weight: 3 }], gain: [0.08, 0.18], detune: [0, 2], wavetableProfile: ['organ'] };
        return { typePool: [{ value: 'sine', weight: 6 }, { value: 'triangle', weight: 3 }], pitch: [{ value: 0.5, weight: 7 }], gain: [0.1, 0.2], detune: [0, 2], wavetableProfile: ['organ'] };
      }
      case 'strings_ensemble': {
        // Slot 0: supersaw, Slot 1: detuned saw, Slot 2: harmonic layer, Slot 3: sub
        if (slotIdx === 0) return { typePool: [{ value: 'supersaw', weight: 7 }, { value: 'sawtooth', weight: 3 }], pitch: [{ value: 1, weight: 8 }], gain: [0.22, 0.35], detune: [0, 5], wavetableProfile: ['warm'] };
        if (slotIdx === 1) return { typePool: [{ value: 'sawtooth', weight: 6 }, { value: 'wavetable', weight: 3 }], pitch: [{ value: 1, weight: 8 }], gain: [0.18, 0.3], detune: [10, 25], wavetableProfile: ['warm', 'sawish'] };
        if (slotIdx === 2) return { typePool: [{ value: 'wavetable', weight: 5 }, { value: 'triangle', weight: 3 }], pitch: [{ value: 2, weight: 5 }, { value: 1, weight: 3 }], gain: [0.1, 0.2], detune: [0, 8], wavetableProfile: ['warm', 'formant'] };
        return { typePool: [{ value: 'sine', weight: 6 }, { value: 'triangle', weight: 3 }], pitch: [{ value: 0.5, weight: 7 }], gain: [0.06, 0.12], detune: [0, 3] };
      }
      case 'synth_lead': {
        // Slot 0: main, Slot 1: detuned, Slot 2: sub or octave
        if (slotIdx === 0) return { typePool: [{ value: 'sawtooth', weight: 5 }, { value: 'square', weight: 4 }, { value: 'supersaw', weight: 3 }, { value: 'fm', weight: 2 }], pitch: [{ value: 1, weight: 8 }], gain: [0.3, 0.45], detune: [0, 4], wavetableProfile: ['bright', 'sawish'] };
        if (slotIdx === 1) return { typePool: [{ value: 'sawtooth', weight: 5 }, { value: 'square', weight: 4 }], pitch: [{ value: 1, weight: 8 }], gain: [0.18, 0.3], detune: [5, 15] };
        return { typePool: [{ value: 'sine', weight: 5 }, { value: 'square', weight: 3 }, { value: 'triangle', weight: 2 }], pitch: [{ value: 0.5, weight: 4 }, { value: 2, weight: 4 }], gain: [0.08, 0.18], detune: [0, 3] };
      }
      case 'pluck': {
        // Slot 0: main pluck body, Slot 1: harmonic transient
        if (slotIdx === 0) return { typePool: [{ value: 'wavetable', weight: 5 }, { value: 'fm', weight: 4 }, { value: 'sawtooth', weight: 3 }], pitch: [{ value: 1, weight: 8 }], gain: [0.35, 0.5], detune: [0, 3], wavetableProfile: ['pluck', 'bright', 'sawish'] };
        return { typePool: [{ value: 'wavetable', weight: 4 }, { value: 'fm', weight: 3 }, { value: 'sawtooth', weight: 2 }], pitch: [{ value: 2, weight: 5 }, { value: 3, weight: 2 }], gain: [0.1, 0.22], detune: [0, 6], wavetableProfile: ['bright', 'bell'] };
      }
      case 'fx_texture':
      default: {
        // Experimental: anything goes
        const typePool = [
          { value: 'sawtooth', weight: 4 },
          { value: 'square', weight: 3 },
          { value: 'fm', weight: 4 },
          { value: 'wavetable', weight: 4 },
          { value: 'noise', weight: 2 },
          { value: 'supersaw', weight: 3 },
          { value: 'pwm', weight: 2 },
          { value: 'pulse', weight: 2 },
          { value: 'sine', weight: 3 },
        ];
        const pitchPool = [
          { value: 0.5, weight: 2 },
          { value: 1, weight: 6 },
          { value: 2, weight: 3 },
          { value: 3, weight: 1 },
        ];
        return { typePool, pitch: pitchPool, gain: [0.1, 0.4], detune: [0, 20], wavetableProfile: ['chaos', 'bell', 'metallic', 'formant', 'sawish'] };
      }
    }
  }

  /**
   * Build a single oscillator config from a slot descriptor.
   */
  _buildSingleOsc(slot, rng) {
    const oscType = rng.weightedPick(slot.typePool);
    const pitchOffset = rng.weightedPick(slot.pitch);
    const gain = rng.nextFloat(...slot.gain);
    const detune = rng.nextFloat(...slot.detune);

    const oscConf = {
      type: oscType,
      detune,
      gain: Math.max(0.02, gain),
      pitchOffset,
      frequency: 440,
    };

    // ─── Supersaw ───
    if (oscType === 'supersaw') {
      oscConf.supersawCount = rng.nextInt(5, 9);
      oscConf.supersawSpread = rng.nextFloat(8, 30);
      oscConf.supersawStereo = rng.nextFloat(0.2, 0.7);
      oscConf.supersawDetunes = [];
      for (let v = 0; v < oscConf.supersawCount; v++) {
        const t = oscConf.supersawCount > 1
          ? (v / (oscConf.supersawCount - 1)) * 2 - 1
          : 0;
        oscConf.supersawDetunes.push(t * oscConf.supersawSpread);
      }
      oscConf.gain = Math.max(0.02, rng.nextClampedGaussian(0.2, 0.08, 0.1, 0.35) / Math.sqrt(oscConf.supersawCount));
    }

    // ─── PWM ───
    if (oscType === 'pwm') {
      oscConf.pwmRate = rng.nextFloat(0.3, 4);
      oscConf.pwmDepth = rng.nextFloat(15, 50);
      oscConf.pwmBaseWidth = rng.nextClampedGaussian(50, 15, 20, 80);
    }

    // ─── Pulse ───
    if (oscType === 'pulse') {
      oscConf.pulseWidth = rng.nextClampedGaussian(30, 15, 12, 85);
    }

    // ─── FM ───
    if (oscType === 'fm') {
      oscConf.fmRatio = rng.weightedPick([
        { value: 0.5, weight: 1 },
        { value: 1, weight: 3 },
        { value: 1.414, weight: 2 },
        { value: 1.5, weight: 2 },
        { value: 2, weight: 4 },
        { value: 2.5, weight: 2 },
        { value: 3, weight: 3 },
        { value: 4, weight: 2 },
        { value: 1.618, weight: 1 },
        { value: 5, weight: 1 },
      ]);
      oscConf.modIndex = rng.nextFloat(1, 20);
      oscConf.carrierType = rng.pick(['sine', 'triangle', 'sine']);
      oscConf.modType = rng.pick(['sine', 'sine', 'triangle']);
    }

    // ─── Wavetable ───
    if (oscType === 'wavetable') {
      const profiles = slot.wavetableProfile || ['sawish', 'warm', 'odd', 'bell', 'formant', 'chaos'];
      const profile = rng.pick(profiles);
      const wt = this._buildWavetable(profile, rng);
      oscConf.real = wt.real;
      oscConf.imag = wt.imag;
      oscConf.wavetableProfile = profile;
    }

    return oscConf;
  }

  // ─── Wavetable Builder ───────────────────────────────────────────

  /**
   * Build a PeriodicWave-compatible wavetable from a named spectral profile.
   * Profiles are inspired by kkox0's PCM waveform categories.
   */
  _buildWavetable(profile, rng) {
    const harmonics = 64;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    const phaseShift = rng.nextFloat(0, Math.PI * 2);

    for (let h = 1; h < harmonics; h++) {
      let amp = 0;
      const phase = phaseShift * (h % 2 === 0 ? 0.7 : 1.0) + rng.nextFloat(-0.2, 0.2);

      switch (profile) {
        case 'piano': {
          // M1 Piano: strong fundamentals, quick harmonic decay, slight inharmonicity
          const inharmonicity = 1 + (h * h) * 0.00008;
          amp = Math.pow(1 / (h * inharmonicity), rng.nextFloat(0.8, 1.4));
          // Emphasize octaves
          if (h === 2 || h === 4) amp *= rng.nextFloat(1.2, 1.8);
          break;
        }
        case 'brass': {
          // M1 Brass: strong odd harmonics like saw, but with formant peak
          const formantCenter = rng.nextInt(3, 6);
          const formantSpread = rng.nextFloat(1.5, 3);
          const formantBoost = Math.exp(-Math.pow((h - formantCenter) / formantSpread, 2)) * 1.5;
          amp = (Math.pow(1 / h, rng.nextFloat(0.6, 1.0)) + formantBoost) / (h < 3 ? 1 : 1.5);
          break;
        }
        case 'organ': {
          // M1 Organ: drawbar simulation — selected harmonics at full strength
          const drawbars = [1, 2, 3, 4, 6, 8, 10, 12, 16];
          if (drawbars.includes(h)) {
            amp = rng.nextFloat(0.4, 1.0);
          } else {
            amp = 0.02;
          }
          break;
        }
        case 'bell': {
          // M1 Bell/Mallet: inharmonic partials with slow decay
          const stretch = rng.nextFloat(1.2, 2.0);
          const partial = Math.pow(h, stretch);
          amp = Math.pow(0.6, Math.abs(partial - h)) * rng.nextFloat(0.5, 1.0);
          break;
        }
        case 'metallic': {
          // Metallic/percussive: very inharmonic, rich
          const metallicStretch = rng.nextFloat(1.3, 2.5);
          amp = Math.pow(0.5, Math.abs(Math.pow(h, metallicStretch) - h)) * rng.nextFloat(0.4, 1.0);
          break;
        }
        case 'warm': {
          // M1 Warm Pad: even-heavy, smooth roll-off
          amp = (h % 2 === 0)
            ? Math.pow(1 / h, rng.nextFloat(0.5, 0.9)) * rng.nextFloat(1.3, 2.0)
            : Math.pow(1 / h, rng.nextFloat(1.0, 1.8));
          break;
        }
        case 'bright': {
          // Bright/sharp: harmonics persist higher up
          amp = Math.pow(1 / h, rng.nextFloat(0.5, 0.9));
          if (h <= 4) amp *= rng.nextFloat(1.2, 1.6);
          break;
        }
        case 'formant': {
          // Formant/vocal: peaks at harmonic bands
          const center1 = rng.nextInt(2, 5);
          const center2 = rng.nextInt(6, 12);
          const spread = rng.nextFloat(1, 3);
          amp = Math.exp(-Math.pow((h - center1) / spread, 2))
            + Math.exp(-Math.pow((h - center2) / spread, 2)) * 0.6;
          break;
        }
        case 'sawish': {
          // Saw-like: 1/n decay
          amp = Math.pow(1 / h, rng.nextFloat(0.7, 1.3));
          break;
        }
        case 'odd': {
          // Square-ish: odd harmonics dominant
          amp = (h % 2 === 1) ? Math.pow(1 / h, rng.nextFloat(0.6, 1.2)) : 0.01;
          break;
        }
        case 'bass': {
          // Deep bass: fundamentals dominate, minimal highs
          amp = (h <= 3) ? Math.pow(1 / h, 0.4) * 1.5 : Math.pow(1 / h, 2.5);
          break;
        }
        case 'pluck': {
          // Pluck: lots of high harmonics that decay fast
          amp = Math.pow(1 / h, rng.nextFloat(0.3, 0.7)) * Math.exp(-h * rng.nextFloat(0.02, 0.06));
          break;
        }
        case 'thin': {
          // Thin/reedy: very few harmonics
          amp = (h <= 3) ? Math.pow(1 / h, 0.5) : 0;
          break;
        }
        case 'chaos':
        default: {
          // Random messy (for fx_texture)
          amp = rng.nextFloat(0, 1) * Math.pow(1 / h, 0.5) * rng.nextFloat(0.3, 1);
          break;
        }
      }

      imag[h] = Math.sin(phase) * amp;
      real[h] = Math.cos(phase) * amp * 0.5;
    }

    return { real, imag };
  }

  // ─── Envelope Builder ─────────────────────────────────────────────

  _buildEnvelope(archetype, rng) {
    const def = ARCHETYPES[archetype].envelope;
    return {
      a: Math.max(0.001, rng.nextFloat(...def.a)),
      d: Math.max(0.01, rng.nextFloat(...def.d)),
      s: rng.nextClampedGaussian(
        (def.s[0] + def.s[1]) / 2,
        (def.s[1] - def.s[0]) / 4,
        def.s[0], def.s[1]
      ),
      r: Math.max(0.03, rng.nextFloat(...def.r)),
    };
  }

  // ─── Filter Builder ───────────────────────────────────────────────

  _buildFilter(archetype, rng) {
    const def = ARCHETYPES[archetype].filter;

    let filterType;
    if (def.type) {
      filterType = def.type;
    } else {
      // fx_texture can get any filter type
      filterType = rng.weightedPick([
        { value: 'lowpass', weight: 5 },
        { value: 'highpass', weight: 2 },
        { value: 'bandpass', weight: 2 },
        { value: 'notch', weight: 1 },
      ]);
    }

    // Log-scale cutoff distribution for natural frequency spread
    const cutoffMin = def.cutoff[0];
    const cutoffMax = def.cutoff[1];
    const cutoff = cutoffMin * Math.pow(cutoffMax / cutoffMin, rng.next());

    const resonance = rng.nextClampedGaussian(
      (def.Q[0] + def.Q[1]) / 2,
      (def.Q[1] - def.Q[0]) / 4,
      def.Q[0], def.Q[1]
    );

    const filterEnvAmount = rng.nextClampedGaussian(
      (def.envAmount[0] + def.envAmount[1]) / 2,
      (def.envAmount[1] - def.envAmount[0]) / 4,
      def.envAmount[0], def.envAmount[1]
    );

    const filterEnvDecay = rng.nextFloat(...def.envDecay);
    const filterEnvSustain = rng.nextFloat(...def.sustain);

    return {
      filterType,
      filterCutoff: Math.round(cutoff),
      filterResonance: resonance,
      filterEnvAmount,
      filterEnvDecay,
      filterEnvSustain,
    };
  }

  // ─── LFO Builder ─────────────────────────────────────────────────

  _buildLFOs(archetype, rng) {
    const lfos = [];
    const lfoTargets = ['cutoff', 'pitch', 'gain'];

    switch (archetype) {
      case 'digital_piano': {
        // Subtle vibrato
        if (rng.next() < 0.6) {
          lfos.push({ waveform: 'sine', rate: rng.nextFloat(4, 6), depth: rng.nextFloat(0.02, 0.06), target: 'pitch' });
        }
        break;
      }
      case 'lush_pad': {
        // Filter sweep + vibrato
        lfos.push({ waveform: rng.pick(['sine', 'triangle']), rate: rng.nextFloat(0.1, 0.8), depth: rng.nextFloat(0.1, 0.35), target: 'cutoff' });
        if (rng.next() < 0.5) {
          lfos.push({ waveform: 'sine', rate: rng.nextFloat(3, 5.5), depth: rng.nextFloat(0.02, 0.06), target: 'pitch' });
        }
        break;
      }
      case 'synth_bass': {
        // Cutoff wobble or none
        if (rng.next() < 0.45) {
          lfos.push({ waveform: rng.pick(['sine', 'triangle']), rate: rng.nextFloat(0.5, 3), depth: rng.nextFloat(0.1, 0.4), target: 'cutoff' });
        }
        break;
      }
      case 'brass': {
        // Subtle gain tremolo
        if (rng.next() < 0.4) {
          lfos.push({ waveform: 'sine', rate: rng.nextFloat(4, 7), depth: rng.nextFloat(0.03, 0.08), target: 'gain' });
        }
        break;
      }
      case 'bell_mallet': {
        // Subtle pitch vibrato for shimmery quality
        if (rng.next() < 0.4) {
          lfos.push({ waveform: 'sine', rate: rng.nextFloat(2, 5), depth: rng.nextFloat(0.01, 0.04), target: 'pitch' });
        }
        break;
      }
      case 'organ': {
        // Rotary speaker simulation: gain tremolo + pitch vibrato
        const rate = rng.nextFloat(0.8, 6);
        lfos.push({ waveform: rng.pick(['sine', 'triangle']), rate, depth: rng.nextFloat(0.05, 0.15), target: 'gain' });
        if (rng.next() < 0.5) {
          lfos.push({ waveform: 'sine', rate: rate * 1.02, depth: rng.nextFloat(0.02, 0.06), target: 'pitch' });
        }
        break;
      }
      case 'strings_ensemble': {
        // Vibrato for ensemble realism
        lfos.push({ waveform: 'sine', rate: rng.nextFloat(4.5, 6), depth: rng.nextFloat(0.03, 0.08), target: 'pitch' });
        if (rng.next() < 0.35) {
          lfos.push({ waveform: rng.pick(['sine', 'triangle']), rate: rng.nextFloat(0.1, 0.5), depth: rng.nextFloat(0.08, 0.2), target: 'cutoff' });
        }
        break;
      }
      case 'synth_lead': {
        // Vibrato (classic lead)
        lfos.push({ waveform: 'sine', rate: rng.nextFloat(4, 7), depth: rng.nextFloat(0.03, 0.1), target: 'pitch' });
        break;
      }
      case 'pluck': {
        // Minimal modulation
        break;
      }
      case 'fx_texture': {
        // Wild modulation
        const lfoCount = rng.weightedPick([
          { value: 0, weight: 2 },
          { value: 1, weight: 4 },
          { value: 2, weight: 3 },
        ]);
        for (let i = 0; i < lfoCount; i++) {
          lfos.push({
            waveform: rng.pick(['sine', 'sawtooth', 'square', 'triangle']),
            rate: Math.max(0.05, rng.nextGaussian(2, 3)),
            depth: rng.nextClampedGaussian(0.15, 0.12, 0.01, 0.8),
            target: rng.pick(lfoTargets),
          });
        }
        break;
      }
    }

    return lfos;
  }

  // ─── Effects Builder ──────────────────────────────────────────────

  _buildEffects(archetype, rng) {
    const effects = {};

    switch (archetype) {
      case 'digital_piano': {
        // M1 Piano: always chorus + reverb
        effects.chorus = {
          rate: rng.nextFloat(0.3, 0.8),
          depth: rng.nextFloat(0.002, 0.006),
          mix: rng.nextClampedGaussian(0.2, 0.08, 0.1, 0.35),
        };
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.2, 0.08, 0.1, 0.4),
          decay: rng.nextFloat(1.5, 3),
          size: rng.nextFloat(0.4, 0.7),
        };
        break;
      }
      case 'lush_pad': {
        // M1 Pad: heavy chorus + lush reverb
        effects.chorus = {
          rate: rng.nextFloat(0.15, 0.5),
          depth: rng.nextFloat(0.003, 0.008),
          mix: rng.nextClampedGaussian(0.35, 0.1, 0.2, 0.55),
        };
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.35, 0.1, 0.15, 0.55),
          decay: rng.nextFloat(2.5, 5),
          size: rng.nextFloat(0.6, 0.95),
        };
        // Sometimes add delay
        if (rng.next() < 0.4) {
          effects.delay = {
            time: rng.nextFloat(0.2, 0.5),
            feedback: rng.nextClampedGaussian(0.25, 0.1, 0.1, 0.45),
            mix: rng.nextClampedGaussian(0.15, 0.06, 0.05, 0.3),
          };
        }
        break;
      }
      case 'synth_bass': {
        // M1 Bass: short reverb, optional subtle distortion for grit
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.1, 0.05, 0.03, 0.2),
          decay: rng.nextFloat(0.5, 1.5),
          size: rng.nextFloat(0.2, 0.4),
        };
        if (rng.next() < 0.35) {
          effects.distortion = {
            drive: rng.nextFloat(1, 4),
            mix: rng.nextClampedGaussian(0.15, 0.08, 0.05, 0.3),
          };
        }
        break;
      }
      case 'brass': {
        // M1 Brass: medium reverb for body
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.22, 0.08, 0.1, 0.4),
          decay: rng.nextFloat(1, 2.5),
          size: rng.nextFloat(0.4, 0.7),
        };
        break;
      }
      case 'bell_mallet': {
        // M1 Bell: long reverb for shimmer
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.35, 0.1, 0.15, 0.55),
          decay: rng.nextFloat(2.5, 5),
          size: rng.nextFloat(0.6, 0.95),
        };
        break;
      }
      case 'organ': {
        // M1 Organ: chorus (rotary sim) + reverb
        effects.chorus = {
          rate: rng.nextFloat(0.6, 1.5),
          depth: rng.nextFloat(0.002, 0.005),
          mix: rng.nextClampedGaussian(0.25, 0.08, 0.1, 0.4),
        };
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.18, 0.08, 0.05, 0.35),
          decay: rng.nextFloat(1, 2.5),
          size: rng.nextFloat(0.35, 0.6),
        };
        break;
      }
      case 'strings_ensemble': {
        // M1 Strings: wide chorus + hall reverb
        effects.chorus = {
          rate: rng.nextFloat(0.2, 0.6),
          depth: rng.nextFloat(0.003, 0.007),
          mix: rng.nextClampedGaussian(0.3, 0.08, 0.15, 0.45),
        };
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.28, 0.1, 0.1, 0.45),
          decay: rng.nextFloat(2, 4),
          size: rng.nextFloat(0.55, 0.85),
        };
        break;
      }
      case 'synth_lead': {
        // M1 Lead: reverb + optional delay
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.2, 0.08, 0.08, 0.35),
          decay: rng.nextFloat(1.5, 3),
          size: rng.nextFloat(0.35, 0.65),
        };
        if (rng.next() < 0.45) {
          effects.delay = {
            time: rng.nextFloat(0.15, 0.45),
            feedback: rng.nextClampedGaussian(0.3, 0.1, 0.1, 0.5),
            mix: rng.nextClampedGaussian(0.18, 0.06, 0.05, 0.3),
          };
        }
        break;
      }
      case 'pluck': {
        // Short reverb + optional delay for texture
        effects.reverb = {
          mix: rng.nextClampedGaussian(0.18, 0.08, 0.05, 0.3),
          decay: rng.nextFloat(0.8, 2),
          size: rng.nextFloat(0.3, 0.55),
        };
        if (rng.next() < 0.5) {
          effects.delay = {
            time: rng.nextFloat(0.1, 0.35),
            feedback: rng.nextClampedGaussian(0.25, 0.1, 0.1, 0.45),
            mix: rng.nextClampedGaussian(0.2, 0.08, 0.05, 0.35),
          };
        }
        break;
      }
      case 'fx_texture': {
        // Wild effects for experimental sounds
        if (rng.next() < 0.7) {
          effects.reverb = {
            mix: rng.nextClampedGaussian(0.3, 0.15, 0.05, 0.6),
            decay: rng.nextFloat(1, 5),
            size: rng.nextFloat(0.3, 0.9),
          };
        }
        if (rng.next() < 0.5) {
          effects.delay = {
            time: rng.nextFloat(0.08, 0.6),
            feedback: rng.nextClampedGaussian(0.35, 0.15, 0.05, 0.65),
            mix: rng.nextClampedGaussian(0.2, 0.1, 0.05, 0.45),
          };
        }
        if (rng.next() < 0.25) {
          effects.distortion = {
            drive: rng.nextFloat(0.5, 5),
            mix: rng.nextClampedGaussian(0.2, 0.1, 0.05, 0.4),
          };
        }
        if (rng.next() < 0.4) {
          effects.chorus = {
            rate: rng.nextFloat(0.2, 2.5),
            depth: rng.nextFloat(0.001, 0.008),
            mix: rng.nextClampedGaussian(0.25, 0.1, 0.1, 0.5),
          };
        }
        break;
      }
    }

    return Object.keys(effects).length > 0 ? effects : null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Voice Management
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Start a note.
   * Routes through arpeggiator if active.
   * @param {number} midiNote - MIDI note number (0-127)
   * @param {number} velocity - 0-1
   */
  noteOn(midiNote, velocity = 0.8) {
    if (!this._initialized || !this._currentConfig) return;

    // If arpeggiator is active, it manages note sequencing
    if (this._arp.active) {
      this._arp.noteOn(midiNote, velocity);
      return;
    }

    this._noteOnDirect(midiNote, velocity);
  }

  /**
   * Stop a note (release phase).
   * Routes through arpeggiator if active.
   */
  noteOff(midiNote) {
    // If arpeggiator is active, it manages note release
    if (this._arp.active) {
      this._arp.noteOff(midiNote);
      return;
    }

    this._noteOffDirect(midiNote);
  }

  /**
   * Direct noteOn — bypasses arpeggiator. Used by the arpeggiator itself.
   */
  _noteOnDirect(midiNote, velocity = 0.8) {
    if (!this._initialized || !this._currentConfig) return;

    // Clamp to playable range
    const note = Math.max(21, Math.min(108, Math.round(midiNote)));

    // If note already playing, release it first
    if (this._activeNotes.has(note)) {
      this.noteOff(note);
    }

    // Find or create a voice
    const maxVoices = SynthEngine.MAX_VOICES;
    let voiceIdx;

    if (this._voicePool.length > 0) {
      voiceIdx = this._voicePool.pop();
    } else if (this._voices.length < maxVoices) {
      voiceIdx = this._voices.length;
      this._voices.push(null);
    } else {
      // Steal oldest voice — immediate reclaim (no waiting for release)
      let stealIdx = null;
      const oldestNote = this._activeNotes.keys().next().value;
      if (oldestNote !== undefined) {
        stealIdx = this._activeNotes.get(oldestNote);
        this._activeNotes.delete(oldestNote);
      } else if (this._sustainedVoices.size > 0) {
        const sustainedIter = this._sustainedVoices.values();
        stealIdx = sustainedIter.next().value;
        this._sustainedVoices.delete(stealIdx);
      }

      if (stealIdx !== null && this._voices[stealIdx]) {
        this._voices[stealIdx].stop();
        this._voices[stealIdx].dispose();
        this._voices[stealIdx] = null;
        voiceIdx = stealIdx;
      } else {
        return; // No voices available
      }
    }

    // Create voice
    const voice = new Voice(
      this._ctx,
      this._effects.input,
      this._currentConfig
    );
    voice.start(note, velocity);

    this._voices[voiceIdx] = voice;
    this._activeNotes.set(note, voiceIdx);
  }

  /**
   * Stop a note (release phase).
   * Voice is kept alive for the release duration, then cleaned up.
   */
  /**
   * Direct noteOff — bypasses arpeggiator. Used by the arpeggiator itself.
   */
  _noteOffDirect(midiNote) {
    const note = Math.round(midiNote);
    if (!this._activeNotes.has(note)) return;

    const voiceIdx = this._activeNotes.get(note);
    const voice = this._voices[voiceIdx];

    if (this._sustainOn) {
      if (voice) {
        this._sustainedVoices.add(voiceIdx);
      }
    } else {
      if (voice) {
        voice.stop();
        // Schedule cleanup after release completes.
        // Capture the voice reference so we don't dispose a
        // newly-allocated voice at the same index (voice stealing).
        const capturedVoice = voice;
        const capturedIdx = voiceIdx;
        const releaseTime = (this._currentConfig?.envelope?.r || 0.3) + 0.1;
        setTimeout(() => {
          capturedVoice.dispose();
          if (this._voices[capturedIdx] === capturedVoice) {
            this._voices[capturedIdx] = null;
            this._voicePool.push(capturedIdx);
          }
        }, releaseTime * 1000);
      }
    }

    this._activeNotes.delete(note);
  }

  /**
   * Stop all active notes immediately.
   */
  allNotesOff() {
    // Stop arpeggiator too
    this._arp.allNotesOff();

    for (const [note, idx] of this._activeNotes) {
      if (this._voices[idx]) {
        this._voices[idx].stop();
        this._voices[idx].dispose();
        this._voices[idx] = null;
        this._voicePool.push(idx);
      }
    }
    this._activeNotes.clear();

    for (const idx of this._sustainedVoices) {
      if (this._voices[idx]) {
        this._voices[idx].stop();
        this._voices[idx].dispose();
        this._voices[idx] = null;
        this._voicePool.push(idx);
      }
    }
    this._sustainedVoices.clear();
    this._sustainOn = false;
  }

  /**
   * Clean up all resources.
   */
  dispose() {
    this.allNotesOff();
    if (this._effects) {
      this._effects.disconnect();
    }
    if (this._masterGain) {
      this._masterGain.disconnect();
    }
    if (this._ctx) {
      this._ctx.close();
    }
    this._initialized = false;
    this._ctx = null;
  }
}
