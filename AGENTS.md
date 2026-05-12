# JW-02 — Agent Context

## Overview
JW-02 is a browser-based polyphonic synthesizer built with vanilla JavaScript and the Web Audio API. It generates deterministic sounds from text hashes (like a seed-based synth patch generator). No external dependencies beyond Vite.

## Tech Stack
- **Build tool:** Vite (`vite dev`, `vite build`, `vite preview`)
- **Language:** ES modules, vanilla JS, no frameworks
- **Audio:** Web Audio API (no external audio libraries)
- **MIDI:** Web MIDI API

## Project Structure
```
src/
  main.js                    — Entry point. Renders UI immediately, defers audio init to first interaction.
  styles.css                 — All styles, no CSS-in-JS.
  synth/
    SynthEngine.js           — Main orchestrator: AudioContext, voice management, patch generation from hashes.
    Voice.js                 — Single polyphonic voice: oscillators, ADSR, filter, LFOs.
    Effects.js               — Global effects chain: reverb, delay, distortion, chorus.
    DeterministicRandom.js   — Seeded RNG for deterministic patch generation.
  ui/
    UI.js                    — DOM builder, event binding, history, status bar.
    KeyboardController.js    — Computer keyboard → MIDI note mapping (A-K, Z/X octave, space panic).
    MIDIController.js        — Web MIDI input: note on/off, CC handling (sustain, pitch bend).
```

## Architecture Notes
- **Two-phase lifecycle:** `UI.render()` creates DOM immediately. `UI.activate()` initializes AudioContext + input on first user gesture (pointerdown/keydown).
- **Polyphony:** Max 16 voices. Oldest active voice is stolen when the pool is exhausted.
- **Voice lifecycle:** `SynthEngine.noteOn()` → `Voice.start()` → `Voice.stop()` (release) → `Voice.dispose()` (cleanup after release tail).
- **Patch generation:** A hash string seeds a deterministic RNG which picks oscillator types, tunings, envelope, filter, LFOs, and effects. Same hash = identical sound.
- **Effects chain:** Per-voice output → global effects (reverb → delay → distortion → chorus) → compressor → master gain.

## Build & Dev
```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run preview  # Preview production build
```

## Code Conventions
- Use ES6 classes with underscore-prefixed private fields (`_foo`).
- JSDoc for public methods.
- Audio nodes are created in constructors/builders, started in `start()`, stopped in `stop()`, and disconnected in `dispose()`.
- Always wrap `disconnect()` and `stop()` in try/catch — AudioNodes throw if already disconnected/stopped.
- Use `setValueAtTime`, `linearRampToValueAtTime`, and `setTargetAtTime` for parameter automation.

## Known Gaps / TODOs
- **Pitch bend:** Not implemented.

## Testing
No test framework is set up yet. Verify changes manually in the browser via `npm run dev`.
