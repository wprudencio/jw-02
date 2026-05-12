/**
 * Voice — A single polyphonic voice with multiple oscillators,
 * ADSR envelope, multi-mode filter, and modulation sources.
 *
 * Architecture per voice:
 *   oscillator(s) → gain → filter → voice output
 *   LFO(s) ───────→ modulate oscillator pitch / filter / gain
 *   envelope ──────→ modulate gain + filter cutoff
 *
 * Velocity sensitivity:
 *   - Gain scales with velocity
 *   - Filter cutoff opens with velocity (brighter on hard hit)
 *   - FM mod index scales with velocity (timbral brightness)
 *   - Envelope attack shortens with velocity (punchier)
 *   - Envelope sustain rises with velocity
 *
 * Each voice config entry in config.oscillators maps to either:
 *   - 1 standard oscillator (sine/saw/square/triangle/wavetable/noise)
 *   - 2 oscillators for FM (modulator + carrier)
 */
export class Voice {
  constructor(ctx, destination, config) {
    this.ctx = ctx;
    this.config = config;
    this.destination = destination;

    // Store oscillators by config index
    this._oscGroups = new Map(); // configIdx -> { oscillators: AudioNode[], gainNodes: GainNode[] }
    this._allOscillators = [];   // flat list for cleanup
    this._modGains = [];
    this._lfoData = [];
    this._outputGain = null;
    this._filterNode = null;
    this._gainEnvNode = null;

    this._build();
  }

  _build() {
    const { ctx, config } = this;
    const now = ctx.currentTime;

    // ─── Master voice envelope gain ───
    this._gainEnvNode = ctx.createGain();
    this._gainEnvNode.gain.setValueAtTime(0, now);

    // ─── Filter ───
    this._filterNode = ctx.createBiquadFilter();
    this._filterNode.type = config.filterType || 'lowpass';
    this._filterNode.frequency.setValueAtTime(
      config.filterCutoff || 20000, now
    );
    this._filterNode.Q.setValueAtTime(config.filterResonance || 0, now);

    // ─── Voice output gain ───
    this._outputGain = ctx.createGain();
    this._outputGain.gain.setValueAtTime(config.voiceGain || 0.3, now);

    // Connect: gainEnv → filter → outputGain → destination
    this._gainEnvNode.connect(this._filterNode);
    this._filterNode.connect(this._outputGain);
    this._outputGain.connect(this.destination);

    // ─── Build oscillators from config ───
    for (let i = 0; i < config.oscillators.length; i++) {
      this._buildOscillator(i, config.oscillators[i]);
    }

    // ─── Build LFOs ───
    if (config.lfos) {
      for (const lfoConf of config.lfos) {
        this._buildLFO(lfoConf);
      }
    }
  }

  /**
   * Build an oscillator (or FM pair) from a config entry.
   * @param {number} idx - Index in config.oscillators
   * @param {object} oscConf - Oscillator configuration
   */
  _buildOscillator(idx, oscConf) {
    const { ctx } = this;
    const now = ctx.currentTime;
    const group = { oscillators: [], gainNodes: [] };

    if (oscConf.type === 'fm') {
      // FM pair: modulator → gain → carrier.frequency
      const modulator = ctx.createOscillator();
      const carrier = ctx.createOscillator();
      const modGain = ctx.createGain();

      modulator.type = oscConf.modType || 'sine';
      carrier.type = oscConf.carrierType || 'sine';

      // Will set frequencies in start()
      modulator.frequency.setValueAtTime(440, now);
      carrier.frequency.setValueAtTime(440, now);
      modGain.gain.setValueAtTime(oscConf.modIndex || 1, now);

      // Routing: modulator → modGain → carrier.frequency
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);

      // Carrier → gain → voice envelope
      const carrierGain = ctx.createGain();
      carrierGain.gain.setValueAtTime(oscConf.gain || 0.3, now);
      carrier.connect(carrierGain);
      carrierGain.connect(this._gainEnvNode);

      group.oscillators.push(modulator, carrier);
      group.gainNodes.push(carrierGain);
      this._modGains.push(modGain);
      this._allOscillators.push(modulator, carrier);
    } else if (oscConf.type === 'noise') {
      // Noise via AudioBufferSourceNode
      const buffer = this._generateNoiseBuffer();
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(oscConf.gain || 0.1, now);
      noise.connect(noiseGain);
      noiseGain.connect(this._gainEnvNode);

      group.oscillators.push(noise);
      group.gainNodes.push(noiseGain);
      this._allOscillators.push(noise);
    } else if (oscConf.type === 'supersaw') {
      // N detuned sawtooth oscillators → individual gain → voice envelope
      const count = oscConf.supersawCount || 7;
      const spread = oscConf.supersawSpread || 15;
      const perOscGain = (oscConf.gain || 0.3) / Math.sqrt(count);
      const detunes = oscConf.supersawDetunes || [];

      // Store per-osc detune on conf for start() to re-apply with global detune
      oscConf._supersawDetunes = detunes;

      for (let v = 0; v < count; v++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);

        // Each voice has micro-offset for spread
        const voiceDetune = detunes[v] || 0;
        osc.detune.setValueAtTime(voiceDetune + (oscConf.detune || 0), now);

        // Chain: osc → gain → voice envelope
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(perOscGain, now);

        osc.connect(gainNode);
        gainNode.connect(this._gainEnvNode);

        group.oscillators.push(osc);
        group.gainNodes.push(gainNode);
        this._allOscillators.push(osc);
      }
    } else if (oscConf.type === 'pwm' || oscConf.type === 'pulse') {
      // PWM/Pulse: generate a PeriodicWave with variable duty cycle
      const real = new Float32Array(64);
      const imag = new Float32Array(64);
      const width = (oscConf.pulseWidth || oscConf.pwmBaseWidth || 50) / 100;

      for (let h = 1; h < 64; h++) {
        // Fourier series for pulse: sin(2πh·width) / (πh)
        imag[h] = Math.sin(2 * Math.PI * h * width) / (Math.PI * h);
      }

      const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.setValueAtTime(440, now);

      if (oscConf.detune) {
        osc.detune.setValueAtTime(oscConf.detune, now);
      }

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(oscConf.gain || 0.3, now);
      osc.connect(gainNode);
      gainNode.connect(this._gainEnvNode);

      group.oscillators.push(osc);
      group.gainNodes.push(gainNode);
      this._allOscillators.push(osc);

      // PWM: add an LFO to modulate the width (recreate wave dynamically)
      // Since we can't modulate PeriodicWave in real-time, modulate detune subtly
      // for a PWM-like effect. Real PWM requires recreating the wave.
      if (oscConf.type === 'pwm') {
        const pwmLfo = ctx.createOscillator();
        pwmLfo.type = 'sine';
        pwmLfo.frequency.setValueAtTime(oscConf.pwmRate || 2, now);
        const pwmGain = ctx.createGain();
        pwmGain.gain.setValueAtTime(oscConf.pwmDepth || 30, now);
        pwmLfo.connect(pwmGain);
        pwmGain.connect(osc.detune);
        pwmLfo.start();

        // Store for cleanup
        this._allOscillators.push(pwmLfo);
        group.oscillators.push(pwmLfo);
      }
    } else {
      // Standard oscillator
      let oscNode;

      if (oscConf.type === 'wavetable' && oscConf.real && oscConf.imag) {
        const wave = ctx.createPeriodicWave(oscConf.real, oscConf.imag, {
          disableNormalization: false,
        });
        oscNode = ctx.createOscillator();
        oscNode.setPeriodicWave(wave);
      } else {
        oscNode = ctx.createOscillator();
        const validTypes = ['sine', 'sawtooth', 'square', 'triangle'];
        oscNode.type = validTypes.includes(oscConf.type) ? oscConf.type : 'sawtooth';
      }

      oscNode.frequency.setValueAtTime(440, now);
      if (oscConf.detune) {
        oscNode.detune.setValueAtTime(oscConf.detune, now);
      }

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(oscConf.gain || 0.3, now);
      oscNode.connect(gainNode);
      gainNode.connect(this._gainEnvNode);

      group.oscillators.push(oscNode);
      group.gainNodes.push(gainNode);
      this._allOscillators.push(oscNode);
    }

    this._oscGroups.set(idx, group);
  }

  /**
   * Build an LFO and prepare its routing.
   */
  _buildLFO(config) {
    const { ctx } = this;
    const now = ctx.currentTime;

    const lfo = ctx.createOscillator();
    lfo.type = config.waveform || 'sine';
    lfo.frequency.setValueAtTime(config.rate || 1, now);

    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(config.depth || 0, now);

    lfo.connect(lfoGain);
    lfo.start();

    this._lfoData.push({
      lfo,
      gain: lfoGain,
      target: config.target,
      depth: config.depth,
    });
  }

  /**
   * Generate a noise buffer — richer variants for better texture.
   * Uses config to pick noise type deterministically.
   */
  _generateNoiseBuffer() {
    const { ctx, config } = this;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Deterministic seed from config hash
    let seed = 12345;
    if (config && config._noiseSeed !== undefined) seed = config._noiseSeed;

    // Generate white noise first
    const white = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      white[i] = (seed / 0x7fffffff) * 2 - 1;
    }

    // Pick noise color based on first oscillator config or default white
    // Pink: -3dB/oct, Brown: -6dB/oct
    const noiseType = (config && config._noiseType) || 'white';

    if (noiseType === 'pink') {
      // Voss-McCartney pink noise approximation
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        b0 = 0.99886 * b0 + white[i] * 0.0555179;
        b1 = 0.99332 * b1 + white[i] * 0.0750759;
        b2 = 0.96900 * b2 + white[i] * 0.1538520;
        b3 = 0.86650 * b3 + white[i] * 0.3104856;
        b4 = 0.55000 * b4 + white[i] * 0.5329522;
        b5 = -0.7616 * b5 - white[i] * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white[i] * 0.5362) * 0.11;
        b6 = white[i] * 0.115926;
      }
    } else if (noiseType === 'brown') {
      // Brownian noise (low-frequency rumble)
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = (last + (0.02 * white[i]));
        if (last > 1) last = 1;
        if (last < -1) last = -1;
        data[i] = last * 3.5; // boost gain
      }
    } else {
      // White noise — just copy
      for (let i = 0; i < length; i++) {
        data[i] = white[i];
      }
    }

    return buffer;
  }

  /**
   * Start the voice playing a given MIDI note.
   * @param {number} midiNote - MIDI note number (21-108)
   * @param {number} velocity - 0-1
   */
  start(midiNote, velocity = 0.8) {
    const { ctx, config } = this;
    const now = ctx.currentTime;
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const velScale = 0.2 + velocity * 0.8;

    // ─── Velocity → filter brightness ───
    // Harder hit opens filter wider
    const velFilterMul = 0.5 + velocity * 1.5; // 0.5..2.0

    // ─── Velocity → envelope shape ───
    const env = config.envelope || { a: 0.01, d: 0.1, s: 0.7, r: 0.3 };
    // Shorter attack on harder hit (punchier)
    const velAttackMul = 1.0 - velocity * 0.6; // 0.4..1.0
    // Higher sustain on harder hit
    const velSustainMul = 0.7 + velocity * 0.3; // 0.7..1.0
    const envA = Math.max(0.001, env.a * velAttackMul);
    const envS = Math.min(1.0, env.s * velSustainMul);
    const envR = env.r * (0.8 + velocity * 0.4); // slightly longer release on hard hit

    // ─── Configure each oscillator group by config index ───
    for (const [idx, oscConf] of config.oscillators.entries()) {
      const group = this._oscGroups.get(idx);
      if (!group) continue;

      const baseFreq = freq * (oscConf.pitchOffset || 1);

      if (oscConf.type === 'fm') {
        const [modulator, carrier] = group.oscillators;
        const modGain = this._modGains[this._findModGainIndex(idx)];

        if (modulator && carrier && modGain) {
          const carrierFreq = baseFreq;
          const modFreq = baseFreq * (oscConf.fmRatio || 1);

          carrier.frequency.setValueAtTime(carrierFreq, now);
          modulator.frequency.setValueAtTime(modFreq, now);
          // Velocity → FM brightness: harder hit = more modulation
          const velModIndex = (oscConf.modIndex || 1) * (0.5 + velocity);
          modGain.gain.setValueAtTime(velModIndex, now);

          if (oscConf.detune) {
            carrier.detune.setValueAtTime(oscConf.detune, now);
          }

          carrier.start(now);
          modulator.start(now);
        }
      } else if (oscConf.type === 'supersaw') {
        for (let v = 0; v < group.oscillators.length; v++) {
          const osc = group.oscillators[v];
          if (osc) {
            osc.frequency.setValueAtTime(baseFreq, now);
            const detunes = oscConf._supersawDetunes || [];
            const voiceDetune = detunes[v] || 0;
            osc.detune.setValueAtTime(voiceDetune + (oscConf.detune || 0), now);
            osc.start(now);
          }
        }
      } else if (oscConf.type === 'noise') {
        const [noise] = group.oscillators;
        if (noise) {
          try { noise.start(now); } catch (e) { /* already started */ }
        }
      } else {
        const [osc] = group.oscillators;
        if (osc) {
          osc.frequency.setValueAtTime(oscConf.pitchOffset ? baseFreq : freq, now);
          osc.frequency.setValueAtTime(baseFreq, now);
          if (oscConf.detune) {
            osc.detune.setValueAtTime(oscConf.detune, now);
          }
          osc.start(now);
        }
      }
    }

    // ─── Set envelope (ADSR) with velocity ───
    const gain = this._gainEnvNode;
    const totalGain = (config.voiceGain || 0.3) * velScale;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    // Musical envelope: exponential attack for natural onset,
    // setTargetAtTime decay for smooth transition to sustain
    if (envA < 0.01) {
      // Percussive/short attack: near-instant for punch
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, totalGain), now + envA);
    } else {
      // Longer attack: shaped curve for pads/strings/brass
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, totalGain * 0.6), now + envA * 0.3);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, totalGain * 0.98), now + envA);
    }
    gain.gain.setTargetAtTime(totalGain * envS, now + envA, env.d * 0.35);

    // ─── Filter envelope (independent ADSR — M1-style) ───
    const filter = this._filterNode;
    const filterCutoff = config.filterCutoff || 20000;
    const filterEnvAmount = config.filterEnvAmount || 0;
    // Independent filter envelope timing (not tied to amp envelope)
    const filterEnvDecay = config.filterEnvDecay || (env.d * 0.5);
    const filterEnvSustain = config.filterEnvSustain ?? 0.6;

    if (filterEnvAmount !== 0) {
      filter.frequency.cancelScheduledValues(now);

      // M1-style: dramatic filter sweep from closed → open → settle
      // Start well below cutoff for audible sweep
      const startFreq = Math.max(20, filterCutoff * 0.2);
      // Peak cutoff: envelope pushes filter wide open (M1 had strong sweeps)
      const peakFreq = Math.max(20, Math.min(20000,
        filterCutoff * velFilterMul * (1 + Math.abs(filterEnvAmount) * 12)
      ));
      // Sustain level: filter settles to a fraction between base and peak
      const sustainFreq = Math.max(20, Math.min(20000,
        filterCutoff * velFilterMul * (filterEnvSustain + (1 - filterEnvSustain) * Math.abs(filterEnvAmount) * 0.3)
      ));

      filter.frequency.setValueAtTime(startFreq, now);
      // Attack phase: filter opens dramatically
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, peakFreq), now + Math.max(0.005, envA * 0.6));
      // Decay phase: filter settles to sustain level with independent timing
      filter.frequency.setTargetAtTime(sustainFreq, now + envA, filterEnvDecay * 0.35);
    } else {
      // Even without env, velocity still affects filter openness
      const velCutoff = Math.max(20, Math.min(20000, filterCutoff * velFilterMul));
      filter.frequency.cancelScheduledValues(now);
      filter.frequency.setValueAtTime(velCutoff, now);
    }

    // ─── Connect LFOs ───
    for (const lfoData of this._lfoData) {
      const { lfo, gain: lfoGain, target } = lfoData;

      // Disconnect first to avoid duplicates
      try { lfoGain.disconnect(); } catch (e) {}

      // Scale LFO depth by velocity for expressiveness
      const velLfoMul = 0.5 + velocity * 0.5;
      const rawDepth = (lfoData.depth || 0) * velLfoMul;

      if (target === 'cutoff') {
        // Scale LFO depth to Hz range based on filter cutoff
        // A depth of 0.2 should produce noticeable wah effect
        const cutoffScale = (config.filterCutoff || 2000) * 0.8;
        lfoGain.gain.setValueAtTime(rawDepth * cutoffScale, now);
        lfoGain.connect(filter.frequency);
      } else if (target === 'pitch') {
        // Scale LFO depth to produce audible vibrato in cents
        // A depth of 0.05 ≈ ±5 cents, 0.1 ≈ ±10 cents at 440Hz
        const pitchScale = freq * 0.15; // modulate in semitones-range
        lfoGain.gain.setValueAtTime(rawDepth * pitchScale, now);
        for (const [idx] of config.oscillators.entries()) {
          const group = this._oscGroups.get(idx);
          if (!group) continue;
          for (const osc of group.oscillators) {
            if (osc && osc.frequency) {
              lfoGain.connect(osc.frequency);
            }
          }
        }
      } else if (target === 'gain') {
        // Gain modulation: depth is already in gain units
        lfoGain.gain.setValueAtTime(rawDepth, now);
        lfoGain.connect(gain.gain);
      } else {
        lfoGain.gain.setValueAtTime(rawDepth, now);
      }
    }

    this._note = midiNote;
  }

  /**
   * Find the mod gain index for a given oscillator config index.
   * Since we push modGains in order of FM oscillators, we need to track this.
   */
  _findModGainIndex(configIdx) {
    let modCount = 0;
    for (let i = 0; i < configIdx; i++) {
      if (this.config.oscillators[i].type === 'fm') {
        modCount++;
      }
    }
    return modCount;
  }

  /**
   * Stop the voice with release phase.
   * Uses shaped release curve for more musical tail-off.
   */
  stop() {
    const { ctx, config } = this;
    const now = ctx.currentTime;
    const env = config.envelope || { a: 0.01, d: 0.1, s: 0.7, r: 0.3 };
    const gain = this._gainEnvNode;
    const releaseDuration = env.r || 0.3;

    // Musical release: exponential fade with initial dip for natural tail
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    // Quick initial dip then smooth exponential tail
    gain.gain.setTargetAtTime(0, now, releaseDuration * 0.35);

    // Also fade filter during release for warmth (M1 characteristic)
    if (this._filterNode && config.filterCutoff) {
      const filter = this._filterNode;
      const currentCutoff = filter.frequency.value;
      // Filter closes during release for warm tail
      const releaseFreq = Math.max(20, Math.min(currentCutoff, config.filterCutoff * 0.4));
      filter.frequency.cancelScheduledValues(now);
      filter.frequency.setValueAtTime(Math.max(20, currentCutoff), now);
      filter.frequency.setTargetAtTime(releaseFreq, now, releaseDuration * 0.5);
    }

    // Stop oscillators after release tail
    const stopTime = now + releaseDuration * 2.5 + 0.1;
    for (const osc of this._allOscillators) {
      try {
        if (osc && typeof osc.stop === 'function') {
          osc.stop(stopTime);
        }
      } catch (e) { /* already stopped */ }
    }
  }

  /** Immediately stop and disconnect everything */
  dispose() {
    const now = this.ctx.currentTime;

    for (const osc of this._allOscillators) {
      try { if (typeof osc.stop === 'function') osc.stop(now); } catch (e) {}
      try { osc.disconnect(); } catch (e) {}
    }

    for (const ld of this._lfoData) {
      try { ld.lfo.stop(now); } catch (e) {}
      try { ld.lfo.disconnect(); } catch (e) {}
      try { ld.gain.disconnect(); } catch (e) {}
    }

    for (const mg of this._modGains) {
      try { mg.disconnect(); } catch (e) {}
    }

    try { this._gainEnvNode.disconnect(); } catch (e) {}
    try { this._filterNode.disconnect(); } catch (e) {}
    try { this._outputGain.disconnect(); } catch (e) {}

    this._oscGroups.clear();
    this._allOscillators = [];
    this._lfoData = [];
    this._modGains = [];
  }
}
