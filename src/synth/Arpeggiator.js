/**
 * Arpeggiator — Steps through held notes in rhythmic patterns.
 *
 * When active, held notes (from keyboard or MIDI) are collected and
 * the arpeggiator cycles through them at a configured rate, emitting
 * noteOn/noteOff events to the synth engine.
 *
 * Patterns:
 *   0  up            — ascending
 *   1  down          — descending
 *   2  up-down       — ascend then descend (no repeat at peaks)
 *   3  down-up       — descend then ascend (no repeat at peaks)
 *   4  random        — deterministic random from held notes
 *   5  ordered       — notes in order they were pressed
 *   6  converge      — outer notes inward toward center
 *   7  diverge       — center notes outward
 *   8  one-up-two-down — rise one, fall two
 *   9  trill         — alternate between lowest and highest
 */

const PATTERN_NAMES = [
  'UP',
  'DOWN',
  'UP-DOWN',
  'DOWN-UP',
  'RANDOM',
  'ORDERED',
  'CONVERGE',
  'DIVERGE',
  '1UP-2DOWN',
  'TRILL',
];

// BPM range
const BPM_MIN = 40;
const BPM_MAX = 300;
const BPM_DEFAULT = 140;

// Clock divisor: how many steps per beat
const DIVISORS = {
  '1/4':  1,
  '1/8':  2,
  '1/8T': 3,   // triplets
  '1/16': 4,
  '1/16T': 6,
  '1/32': 8,
};

const DIVISOR_KEYS = Object.keys(DIVISORS);

export class Arpeggiator {
  constructor(engine) {
    this._engine = engine;

    // State
    this._active = false;
    this._pattern = 0;           // index into PATTERN_NAMES
    this._bpm = BPM_DEFAULT;
    this._divisorKey = '1/8';   // default subdivision
    this._gate = 0.5;            // gate length as fraction (0–1)
    this._octaveExpand = 1;      // 1 = no expand, 2 = +1 octave, 3 = +2 octaves

    // Held notes: ordered array of MIDI note numbers
    this._heldNotes = [];
    this._heldVelocities = new Map(); // midiNote -> velocity

    // Internal sequencer state
    this._stepIndex = 0;
    this._stepSequence = [];      // pre-computed sequence of MIDI notes
    this._playing = false;
    this._currentNote = null;
    this._timerId = null;
    this._nextStepTime = 0;

    // For random pattern — seeded from current hash
    this._rngState = 0;
  }

  /** Whether the arpeggiator is enabled */
  get active() { return this._active; }

  /** Current pattern index (0–9) */
  get pattern() { return this._pattern; }

  /** Current pattern name */
  get patternName() { return PATTERN_NAMES[this._pattern]; }

  /** All pattern names */
  static get patternNames() { return [...PATTERN_NAMES]; }

  /** BPM */
  get bpm() { return this._bpm; }

  /** Gate length fraction (0–1) */
  get gate() { return this._gate; }

  /** Divisor key e.g. '1/8' */
  get divisorKey() { return this._divisorKey; }

  /** Octave expand count */
  get octaveExpand() { return this._octaveExpand; }

  /** Whether the arp is currently sequencing (has held notes and is active) */
  get playing() { return this._playing; }

  // ─── Control ─────────────────────────────────────────

  /**
   * Enable / disable the arpeggiator.
   */
  setActive(on) {
    this._active = !!on;
    if (!this._active) {
      this._stop();
    } else if (this._heldNotes.length > 0) {
      this._rebuildSequence();
      this._start();
    }
  }

  /**
   * Set the pattern index (0–9).
   */
  setPattern(idx) {
    this._pattern = Math.max(0, Math.min(PATTERN_NAMES.length - 1, idx));
    if (this._playing) {
      this._stepIndex = 0;
      this._rebuildSequence();
    }
  }

  /**
   * Set BPM.
   */
  setBPM(bpm) {
    this._bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
  }

  /**
   * Set divisor key ('1/4', '1/8', etc.)
   */
  setDivisorKey(key) {
    if (DIVISORS[key] !== undefined) {
      this._divisorKey = key;
    }
  }

  /**
   * Set gate length (0–1).
   */
  setGate(gate) {
    this._gate = Math.max(0.05, Math.min(1.0, gate));
  }

  /**
   * Set octave expansion (1–3).
   */
  setOctaveExpand(count) {
    this._octaveExpand = Math.max(1, Math.min(3, count));
    if (this._playing) {
      this._stepIndex = 0;
      this._rebuildSequence();
    }
  }

  // ─── Held Notes ────────────────────────────────────

  /**
   * A note was pressed. If arp is active, add to held notes and start/rebuild sequence.
   * Returns true if the arp consumed the note (engine should NOT play it directly).
   */
  noteOn(midiNote, velocity = 0.8) {
    if (!this._active) return false;

    if (!this._heldNotes.includes(midiNote)) {
      this._heldNotes.push(midiNote);
    }
    this._heldVelocities.set(midiNote, velocity);

    this._rebuildSequence();

    if (!this._playing) {
      this._start();
    }

    return true;
  }

  /**
   * A note was released. If arp is active, remove from held notes.
   * Returns true if arp consumed the release.
   */
  noteOff(midiNote) {
    if (!this._active) return false;

    const idx = this._heldNotes.indexOf(midiNote);
    if (idx !== -1) {
      this._heldNotes.splice(idx, 1);
    }
    this._heldVelocities.delete(midiNote);

    if (this._heldNotes.length === 0) {
      this._stop();
    } else {
      this._rebuildSequence();
      // Clamp step index
      if (this._stepIndex >= this._stepSequence.length) {
        this._stepIndex = 0;
      }
    }

    return true;
  }

  /**
   * All notes off — panic stop.
   */
  allNotesOff() {
    this._heldNotes = [];
    this._heldVelocities.clear();
    this._stop();
  }

  // ─── Sequence Generation ────────────────────────────

  /**
   * Build the step sequence from held notes and current pattern.
   */
  _rebuildSequence() {
    if (this._heldNotes.length === 0) {
      this._stepSequence = [];
      return;
    }

    // Sort and deduplicate held notes
    const sorted = [...this._heldNotes].sort((a, b) => a - b);
    const unique = [...new Set(sorted)];

    // Expand by octaves
    const notes = this._expandOctaves(unique);

    this._stepSequence = this._applyPattern(notes);
    this._rngState = this._hashRNGSeed();
  }

  /**
   * Expand note set across additional octaves.
   */
  _expandOctaves(notes) {
    if (this._octaveExpand <= 1) return notes;

    const expanded = [];
    for (let oct = 0; oct < this._octaveExpand; oct++) {
      for (const n of notes) {
        expanded.push(n + oct * 12);
      }
    }
    return expanded;
  }

  /**
   * Apply the currently selected pattern to produce a step sequence.
   */
  _applyPattern(notes) {
    if (notes.length === 0) return [];
    if (notes.length === 1) return [notes[0]]; // single note just repeats

    switch (this._pattern) {
      case 0: return this._patternUp(notes);
      case 1: return this._patternDown(notes);
      case 2: return this._patternUpDown(notes);
      case 3: return this._patternDownUp(notes);
      case 4: return this._patternRandom(notes);
      case 5: return this._patternOrdered(notes);
      case 6: return this._patternConverge(notes);
      case 7: return this._patternDiverge(notes);
      case 8: return this._patternOneUpTwoDown(notes);
      case 9: return this._patternTrill(notes);
      default: return notes;
    }
  }

  // ─── Pattern Implementations ───────────────────────

  _patternUp(notes) {
    return [...notes];
  }

  _patternDown(notes) {
    return [...notes].reverse();
  }

  _patternUpDown(notes) {
    // up then down, no repeat at peaks
    const up = [...notes];
    const down = notes.slice(1, -1).reverse();
    return [...up, ...down];
  }

  _patternDownUp(notes) {
    // down then up, no repeat at peaks
    const down = [...notes].reverse();
    const up = notes.slice(1, -1);
    return [...down, ...up];
  }

  _patternRandom(notes) {
    // Deterministic shuffle using simple LCG seeded from held notes
    const seq = [...notes];
    let seed = 0;
    for (const n of notes) seed = (seed * 31 + n) & 0x7fffffff;
    for (let i = seq.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [seq[i], seq[j]] = [seq[j], seq[i]];
    }
    return seq;
  }

  _patternOrdered(notes) {
    // Play in insertion order from held notes, then expanded octaves
    // Since notes is already sorted+deduped+expanded from _expandOctaves,
    // we use _heldNotes insertion order as a seed and expand similarly.
    const base = [...new Set(this._heldNotes)].sort((a, b) => a - b);
    const expanded = this._expandOctaves(base);
    return expanded.length > 0 ? expanded : notes;
  }

  _patternConverge(notes) {
    // Outer notes inward: lowest, highest, 2nd lowest, 2nd highest, ...
    const result = [];
    let lo = 0, hi = notes.length - 1;
    while (lo <= hi) {
      result.push(notes[lo]);
      if (lo !== hi) result.push(notes[hi]);
      lo++;
      hi--;
    }
    return result;
  }

  _patternDiverge(notes) {
    // Center notes outward — reverse of converge
    const mid = Math.floor(notes.length / 2);
    const result = [];
    let left = mid - (notes.length % 2 === 0 ? 1 : 0);
    let right = mid + (notes.length % 2 === 0 ? 0 : 1);

    // Start from center
    if (notes.length % 2 === 1) {
      result.push(notes[mid]);
      left = mid - 1;
      right = mid + 1;
    } else {
      left = mid - 1;
      right = mid;
    }

    while (left >= 0 || right < notes.length) {
      if (left >= 0) result.push(notes[left]);
      if (right < notes.length) result.push(notes[right]);
      left--;
      right++;
    }
    return result;
  }

  _patternOneUpTwoDown(notes) {
    // Rise one, fall two — creates a sawtooth-like arp pattern
    // Walk up by 1 step, then down by 2
    if (notes.length <= 2) return this._patternUp(notes);

    const result = [];
    let i = 0;
    let goingUp = true;

    // Generate enough steps to cover the full range twice
    const totalSteps = notes.length * 3;
    for (let step = 0; step < totalSteps; step++) {
      if (i >= 0 && i < notes.length) {
        result.push(notes[i]);
      }
      if (goingUp) {
        i += 1;
        if (i >= notes.length) {
          goingUp = false;
          i = notes.length - 2;
        }
      } else {
        i -= 2;
        if (i < 0) {
          goingUp = true;
          i = 1;
        }
      }
    }

    // Deduplicate while preserving order
    const seen = new Set();
    const unique = [];
    for (const n of result) {
      if (!seen.has(n)) {
        seen.add(n);
        unique.push(n);
      }
    }
    return unique.length > 0 ? unique : notes;
  }

  _patternTrill(notes) {
    // Alternate lowest and highest
    const lo = notes[0];
    const hi = notes[notes.length - 1];
    const result = [];
    for (let i = 0; i < notes.length; i++) {
      result.push(i % 2 === 0 ? lo : hi);
    }
    return result;
  }

  // ─── Sequencer Loop ─────────────────────────────────

  _start() {
    if (this._playing) return;
    if (this._stepSequence.length === 0) return;

    this._playing = true;
    this._stepIndex = 0;
    this._nextStepTime = 0; // will be set on first tick

    this._tick();
  }

  _stop() {
    this._playing = false;
    this._stepIndex = 0;

    if (this._currentNote !== null) {
      this._engine._noteOffDirect(this._currentNote);
      this._currentNote = null;
    }

    if (this._timerId !== null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  _tick() {
    if (!this._playing || !this._active) {
      this._playing = false;
      return;
    }

    if (this._stepSequence.length === 0) {
      this._stop();
      return;
    }

    const ctx = this._engine._ctx;
    if (!ctx) return;

    // Step interval in ms
    const stepsPerBeat = DIVISORS[this._divisorKey] || 2;
    const stepDuration = (60000 / this._bpm) / stepsPerBeat; // ms per step
    const gateDuration = stepDuration * this._gate; // ms for note-on

    const now = performance.now();

    // If we don't have a scheduled time, start now
    if (this._nextStepTime === 0) {
      this._nextStepTime = now;
    }

    // Ensure we don't drift too far
    if (this._nextStepTime < now - stepDuration * 2) {
      this._nextStepTime = now;
    }

    // Play current step
    this._playStep(this._stepIndex);

    // Advance step
    this._stepIndex = (this._stepIndex + 1) % this._stepSequence.length;

    // Schedule next tick
    this._nextStepTime += stepDuration;
    const delay = Math.max(1, this._nextStepTime - performance.now());

    this._timerId = setTimeout(() => this._tick(), delay);
  }

  _playStep(stepIdx) {
    if (stepIdx >= this._stepSequence.length) {
      stepIdx = 0;
    }

    // Turn off previous note
    if (this._currentNote !== null) {
      this._engine._noteOffDirect(this._currentNote);
    }

    // Use velocity from the held note, or map back from octave-expanded note
    const note = this._stepSequence[stepIdx];
    if (note === undefined) return;
    let velocity = this._heldVelocities.get(note);
    if (velocity === undefined) {
      // Try to find velocity from a base note (octave-expanded notes share velocity)
      const baseNote = this._heldVelocities.keys().next().value;
      velocity = baseNote !== undefined ? this._heldVelocities.get(baseNote) : 0.8;
    }
    velocity = velocity || 0.8;

    // Turn on new note with original velocity
    this._engine._noteOnDirect(note, velocity);
    this._currentNote = note;

    // Schedule note-off based on gate
    const stepsPerBeat = DIVISORS[this._divisorKey] || 2;
    const stepDuration = (60000 / this._bpm) / stepsPerBeat;
    const gateDuration = stepDuration * this._gate;

    // We'll let the next tick handle note-off for simple approach,
    // but for short gates we need a timer
    const offDelay = Math.max(20, gateDuration - 5); // slight early to avoid overlap
    setTimeout(() => {
      // Only turn off if it's still the current note
      if (this._currentNote === note) {
        this._engine._noteOffDirect(note);
      }
    }, offDelay);
  }

  // ─── Helpers ────────────────────────────────────────

  _hashRNGSeed() {
    let seed = 0;
    for (const n of this._heldNotes) {
      seed = (seed * 31 + n) & 0x7fffffff;
    }
    return seed;
  }

  /** Get config for serialization / display */
  getConfig() {
    return {
      active: this._active,
      pattern: this._pattern,
      bpm: this._bpm,
      divisor: this._divisorKey,
      gate: this._gate,
      octaveExpand: this._octaveExpand,
    };
  }
}