/**
 * MIDIController — Handles Web MIDI API input.
 *
 * Connects to all available MIDI input devices and forwards
 * note on/off events to the synth engine.
 */
export class MIDIController {
  constructor(engine) {
    this._engine = engine;
    this._midiAccess = null;
    this._inputs = [];
    this._connected = false;
    this._onStateChange = null;
  }

  /** Whether MIDI is connected and active */
  get connected() { return this._connected; }

  /** Get the number of connected MIDI devices */
  get deviceCount() { return this._inputs.length; }

  /**
   * Request MIDI access and connect to all inputs.
   */
  async init() {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not available');
      return false;
    }

    try {
      this._midiAccess = await navigator.requestMIDIAccess();

      this._onStateChange = () => this._updateInputs();
      this._midiAccess.addEventListener('statechange', this._onStateChange);

      this._updateInputs();
      return true;
    } catch (err) {
      console.warn('MIDI access denied:', err);
      return false;
    }
  }

  /** Disconnect from all MIDI inputs */
  disconnect() {
    if (this._onStateChange && this._midiAccess) {
      this._midiAccess.removeEventListener('statechange', this._onStateChange);
    }
    for (const input of this._inputs) {
      try { input.close(); } catch (e) { /* ignore */ }
    }
    this._inputs = [];
    this._connected = false;
    this._midiAccess = null;
  }

  _updateInputs() {
    // Remove old listeners
    for (const input of this._inputs) {
      try {
        input.removeEventListener('midimessage', this._onMIDIMessage);
      } catch (e) { /* ignore */ }
    }
    this._inputs = [];

    // Connect to all inputs
    const iter = this._midiAccess.inputs.values();
    for (const input of iter) {
      input.addEventListener('midimessage', (e) => this._onMIDIMessage(e));
      this._inputs.push(input);
    }

    this._connected = this._inputs.length > 0;
  }

  _onMIDIMessage(event) {
    const [status, note, velocity] = event.data;
    const type = status & 0xf0;

    switch (type) {
      case 0x90: // Note On
        if (velocity > 0) {
          this._engine.noteOn(note, velocity / 127);
        } else {
          // Velocity 0 = note off (running status optimization)
          this._engine.noteOff(note);
        }
        break;

      case 0x80: // Note Off
        this._engine.noteOff(note);
        break;

      case 0xb0: // Control Change
        if (note === 64) {
          if (velocity >= 64) {
            this._engine.sustainOn();
          } else {
            this._engine.sustainOff();
          }
        }
        break;

      case 0xe0: // Pitch Bend
        // Not implemented yet
        break;
    }
  }
}
