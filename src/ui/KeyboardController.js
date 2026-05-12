/**
 * KeyboardController — Maps computer keyboard to MIDI notes.
 *
 * Layout:
 *   White keys: A S D F G H J K
 *   Black keys: W E   T Y U
 *   Octave:     Z (down)  X (up)
 *   Panic:      Space (all notes off)
 *
 * Base octave: C3 (MIDI 48) for the leftmost key (A)
 */

// Semitone offsets from C3 for each key
const KEY_MAP = {
  'a': 0,   // C3
  'w': 1,   // C#3
  's': 2,   // D3
  'e': 3,   // D#3
  'd': 4,   // E3
  'f': 5,   // F3
  't': 6,   // F#3
  'g': 7,   // G3
  'y': 8,   // G#3
  'h': 9,   // A3
  'u': 10,  // A#3
  'j': 11,  // B3
  'k': 12,  // C4
};

const BASE_NOTE = 48; // C3

export class KeyboardController {
  constructor(engine) {
    this._engine = engine;
    this._octaveShift = 0;
    this._pressed = new Set();
    this._boundHandlers = null;
    this._enabled = false;
  }

  get enabled() { return this._enabled; }
  get octaveShift() { return this._octaveShift; }

  enable() {
    if (this._enabled) return;
    this._enabled = true;

    this._boundHandlers = {
      keydown: (e) => this._onKeyDown(e),
      keyup: (e) => this._onKeyUp(e),
    };

    window.addEventListener('keydown', this._boundHandlers.keydown);
    window.addEventListener('keyup', this._boundHandlers.keyup);
  }

  disable() {
    if (!this._enabled) return;
    this._enabled = false;

    for (const key of this._pressed) {
      const note = this._keyToNote(key);
      if (note !== null) this._engine.noteOff(note);
    }
    this._pressed.clear();

    if (this._boundHandlers) {
      window.removeEventListener('keydown', this._boundHandlers.keydown);
      window.removeEventListener('keyup', this._boundHandlers.keyup);
      this._boundHandlers = null;
    }
  }

  /** Convert a key to MIDI note number */
  _keyToNote(key) {
    const semi = KEY_MAP[key];
    if (semi === undefined) return null;
    return BASE_NOTE + semi + this._octaveShift * 12;
  }

  /** Get the note name for display */
  keyToNoteName(key) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const semi = KEY_MAP[key.toLowerCase()];
    if (semi === undefined) return null;
    const midiNote = BASE_NOTE + semi + this._octaveShift * 12;
    const octave = Math.floor(midiNote / 12) - 1;
    const noteIdx = midiNote % 12;
    return `${noteNames[noteIdx]}${octave}`;
  }

  _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toLowerCase();

    // Octave shift
    if (key === 'z') {
      this._octaveShift = Math.max(-2, this._octaveShift - 1);
      e.preventDefault();
      return;
    }
    if (key === 'x') {
      this._octaveShift = Math.min(2, this._octaveShift + 1);
      e.preventDefault();
      return;
    }

    // Space = panic (all notes off)
    if (key === ' ') {
      this._engine.allNotesOff();
      e.preventDefault();
      return;
    }

    if (this._pressed.has(key)) return;

    const note = this._keyToNote(key);
    if (note === null) return;

    this._pressed.add(key);
    this._engine.noteOn(note, 0.8);
    e.preventDefault();
  }

  _onKeyUp(e) {
    const key = e.key.toLowerCase();
    if (!this._pressed.has(key)) return;

    this._pressed.delete(key);
    const note = this._keyToNote(key);
    if (note !== null) this._engine.noteOff(note);
    e.preventDefault();
  }
}
