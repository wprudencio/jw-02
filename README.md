<img width="674" height="98" alt="image" src="https://github.com/user-attachments/assets/436b7a1e-40da-4e96-8429-a2095fa9d86a" />

A browser-based polyphonic synthesizer with deterministic sound generation from text hashes. Built with vanilla JavaScript and the Web Audio API — no external audio libraries.

**Try it:** every text hash produces the same sound every time. Type anything, press LOAD, and get a unique synth patch.

> 🚧 This is an experimental project. Some features are still in development.

## Features

- **16-voice polyphonic synthesis** with configurable oscillator count (2–4 voices per note)
- **10 oscillator types:** sawtooth, square, sine, triangle, FM, wavetable, noise, supersaw, PWM, pulse
- **Multi-mode resonant filter** with envelope modulation (lowpass, highpass, bandpass, notch, lowshelf, highshelf)
- **ADSR envelope** with velocity sensitivity (attack, sustain, release all respond to velocity)
- **Up to 2 modulation LFOs** targeting filter cutoff, pitch, or gain
- **Global effects chain:** reverb (convolved noise IR), delay, distortion (waveshaping), chorus/stereo widening
- **Master compressor** for consistent volume across patches
- **Deterministic sound generation** — same hash = same patch, every time
- **Computer keyboard input** — play notes on A–K (white keys) + W/E/T/Y/U (black keys), Z/X for octave shift, Space for panic
- **MIDI input** — connect any MIDI controller via Web MIDI API (note on/off, sustain pedal)
- **History panel** — browse previously generated hashes
- **Dark, industrial UI** with responsive design

## How It Works

1. A hash string (8 alphanumeric characters like `JKH4 9XM2`) seeds a deterministic random number generator (Mulberry32).
2. The RNG generates a complete synth configuration: oscillator types, tunings, envelope, filter, LFOs, and effects.
3. The same hash always produces the identical configuration, so sounds are reproducible and shareable.

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Usage

1. **Activate:** Click anywhere on the page to initialize the audio engine.
2. **Generate:** Click the GENERATE button (or press Shift) to create a random hash and its corresponding sound.
3. **Load a hash:** Type any text into the input field and press LOAD or Enter to hear its deterministic patch.
4. **Play notes:** Use your computer keyboard (A–K for white keys, W/E/T/Y/U for black keys) or connect a MIDI controller.
5. **Adjust volume:** Use the volume slider.
6. **Copy a hash:** Click on the hash display to copy it to your clipboard.
7. **Browse history:** Click on any previous hash in the history panel to revisit that sound.

### Keyboard Layout

| Key | Note | Key | Note |
|-----|------|-----|------|
| A   | C3   | W   | C#3  |
| S   | D3   | E   | D#3  |
| D   | E3   | T   | F#3  |
| F   | F3   | Y   | G#3  |
| G   | G3   | U   | A#3  |
| H   | A3   |     |      |
| J   | B3   |     |      |
| K   | C4   |     |      |

- **Z**: Octave down
- **X**: Octave up
- **Space**: Panic (all notes off)

## Project Structure

```
src/
  main.js                    — Entry point. Renders UI immediately, defers audio init to first interaction.
  styles.css                 — All styles (dark industrial design system).
  synth/
    SynthEngine.js           — Main orchestrator: AudioContext, voice management, patch generation from hashes.
    Voice.js                 — Single polyphonic voice: oscillators, ADSR, filter, LFOs.
    Effects.js               — Global effects chain: reverb, delay, distortion, chorus.
    DeterministicRandom.js   — Seeded PRNG (Mulberry32) for deterministic patch generation.
  ui/
    UI.js                    — DOM builder, event binding, history, status bar.
    KeyboardController.js    — Computer keyboard → MIDI note mapping.
    MIDIController.js        — Web MIDI input: note on/off, CC handling.
```

## Architecture

- **Two-phase lifecycle:** UI renders immediately on page load. AudioContext is initialized on the first user gesture (click or keypress) to comply with browser autoplay policies.
- **Polyphony:** Up to 16 simultaneous voices. The oldest active voice is stolen when the pool is exhausted.
- **Voice lifecycle:** `noteOn()` → `Voice.start()` → `Voice.stop()` (release phase) → `Voice.dispose()` (cleanup after release tail).
- **Effects chain:** Per-voice output → global effects (reverb → delay → distortion → chorus) → compressor → master gain.
- **Patch generation:** A hash string seeds a deterministic RNG which selects oscillator types, tunings, envelopes, filter settings, LFOs, and effects. Same hash = identical sound.

## Known Gaps

- **Pitch bend** — not yet implemented.

## Tech Stack

- **Build tool:** [Vite](https://vitejs.dev/)
- **Audio:** Web Audio API (no external audio libraries)
- **MIDI:** Web MIDI API
- **Language:** Vanilla JavaScript (ES modules, no frameworks)

## License

MIT
