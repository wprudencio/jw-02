/**
 * Effects — Global effects chain for the synth engine.
 * Chain: Reverb → Delay → Distortion → Chorus → Master
 *
 * All effects are built from the Web Audio API with no external dependencies.
 * Reverb uses a procedurally-generated impulse response (noise → exponential decay).
 */
export class Effects {
  constructor(ctx) {
    this.ctx = ctx;

    // Routing nodes
    this._input = ctx.createGain();
    this._compressor = ctx.createDynamicsCompressor();
    this._compressor.threshold.setValueAtTime(-24, ctx.currentTime);
    this._compressor.knee.setValueAtTime(12, ctx.currentTime);
    this._compressor.ratio.setValueAtTime(4, ctx.currentTime);
    this._compressor.attack.setValueAtTime(0.005, ctx.currentTime);
    this._compressor.release.setValueAtTime(0.25, ctx.currentTime);
    this._master = ctx.createGain();
    this._master.gain.setValueAtTime(0.85, ctx.currentTime);

    // Effect nodes (created in build())
    this._reverbNode = null;
    this._reverbWet = null;
    this._delayNode = null;
    this._delayFeedback = null;
    this._delayWet = null;
    this._distortionNode = null;
    this._distortionWet = null;
    this._chorusNodes = [];

    // Config
    this._config = null;

    // Dry/wet mix helpers
    this._dryGain = ctx.createGain();
    this._wetGain = ctx.createGain();

    // Default passthrough
    this._compressor.connect(this._master);
    this._input.connect(this._compressor);

    // Build initial
    this._build();
  }

  /** Get the input node for the effects chain */
  get input() { return this._input; }

  /** Get the master output node */
  get output() { return this._master; }

  /** Connect destination */
  connect(destination) {
    this._master.connect(destination);
  }

  disconnect() {
    this._master.disconnect();
  }

  /**
   * Build/rebuild the effects chain from a configuration object.
   * If no config provided, uses defaults (no effects).
   */
  _build(config) {
    const { ctx } = this;
    this._config = config || null;

    // Disconnect everything
    try { this._input.disconnect(); } catch (e) {}
    try { this._dryGain.disconnect(); } catch (e) {}
    try { this._wetGain.disconnect(); } catch (e) {}

    // Clean up old chorus nodes
    for (const n of this._chorusNodes) {
      try { n.disconnect(); } catch (e) {}
    }
    this._chorusNodes = [];

    if (!config) {
      // Dry passthrough
      this._input.connect(this._compressor);
      return;
    }

    // Build effects chain
    let currentInput = this._input;

    // ─── 1. Reverb ───
    if (config.reverb && config.reverb.mix > 0) {
      const convolver = ctx.createConvolver();
      const reverbWet = ctx.createGain();
      reverbWet.gain.setValueAtTime(config.reverb.mix, ctx.currentTime);

      // Generate impulse response
      const ir = this._generateImpulseResponse(
        config.reverb.decay || 2,
        config.reverb.size || 0.5
      );
      convolver.buffer = ir;

      const dryGain = ctx.createGain();
      dryGain.gain.setValueAtTime(1 - config.reverb.mix, ctx.currentTime);

      currentInput.connect(dryGain);
      currentInput.connect(convolver);
      convolver.connect(reverbWet);

      // Mix dry + wet
      const mixer = ctx.createGain();
      dryGain.connect(mixer);
      reverbWet.connect(mixer);
      currentInput = mixer;

      this._reverbNode = { convolver, dryGain, reverbWet };
    }

    // ─── 2. Delay ───
    if (config.delay && config.delay.mix > 0) {
      const delay = ctx.createDelay(1.0);
      delay.delayTime.setValueAtTime(config.delay.time || 0.25, ctx.currentTime);

      const feedback = ctx.createGain();
      feedback.gain.setValueAtTime(config.delay.feedback || 0.3, ctx.currentTime);

      const delayWet = ctx.createGain();
      delayWet.gain.setValueAtTime(config.delay.mix, ctx.currentTime);

      const dryGain = ctx.createGain();
      dryGain.gain.setValueAtTime(1 - config.delay.mix, ctx.currentTime);

      currentInput.connect(dryGain);

      // Delay feedback loop
      currentInput.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay); // feedback
      delay.connect(delayWet);

      // Mix
      const mixer = ctx.createGain();
      dryGain.connect(mixer);
      delayWet.connect(mixer);
      currentInput = mixer;

      this._delayNode = { delay, feedback, delayWet };
    }

    // ─── 3. Distortion ───
    if (config.distortion && config.distortion.drive > 0) {
      const shaper = ctx.createWaveShaper();
      const drive = config.distortion.drive;
      const curve = this._generateDistortionCurve(512, drive);
      shaper.curve = curve;
      shaper.oversample = '4x'; // Better quality anti-aliasing

      const distWet = ctx.createGain();
      distWet.gain.setValueAtTime(config.distortion.mix || 0.5, ctx.currentTime);

      const dryGain = ctx.createGain();
      dryGain.gain.setValueAtTime(1 - (config.distortion.mix || 0.5), ctx.currentTime);

      currentInput.connect(dryGain);
      currentInput.connect(shaper);
      shaper.connect(distWet);

      const mixer = ctx.createGain();
      dryGain.connect(mixer);
      distWet.connect(mixer);
      currentInput = mixer;

      this._distortionNode = { shaper, distWet };
    }

    // ─── 4. Chorus / Stereo Widening ───
    if (config.chorus && config.chorus.mix > 0) {
      const rate = config.chorus.rate || 0.5;
      const depth = config.chorus.depth || 0.003;
      const mix = config.chorus.mix || 0.3;

      // Left channel
      const delayL = ctx.createDelay(0.05);
      delayL.delayTime.setValueAtTime(0.01, ctx.currentTime);
      const lfoL = ctx.createOscillator();
      lfoL.type = 'sine';
      lfoL.frequency.setValueAtTime(rate, ctx.currentTime);
      const lfoGainL = ctx.createGain();
      lfoGainL.gain.setValueAtTime(depth, ctx.currentTime);
      lfoL.connect(lfoGainL);
      lfoGainL.connect(delayL.delayTime);
      lfoL.start();

      // Right channel
      const delayR = ctx.createDelay(0.05);
      delayR.delayTime.setValueAtTime(0.015, ctx.currentTime);
      const lfoR = ctx.createOscillator();
      lfoR.type = 'sine';
      lfoR.frequency.setValueAtTime(rate * 1.05, ctx.currentTime);
      const lfoGainR = ctx.createGain();
      lfoGainR.gain.setValueAtTime(depth, ctx.currentTime);
      lfoR.connect(lfoGainR);
      lfoGainR.connect(delayR.delayTime);
      lfoR.start();

      // Split current signal
      const splitL = ctx.createGain();
      const splitR = ctx.createGain();

      const chorusWetL = ctx.createGain();
      chorusWetL.gain.setValueAtTime(mix, ctx.currentTime);
      const chorusWetR = ctx.createGain();
      chorusWetR.gain.setValueAtTime(mix, ctx.currentTime);

      const dryGainL = ctx.createGain();
      dryGainL.gain.setValueAtTime(1 - mix, ctx.currentTime);
      const dryGainR = ctx.createGain();
      dryGainR.gain.setValueAtTime(1 - mix, ctx.currentTime);

      currentInput.connect(splitL);
      currentInput.connect(splitR);

      splitL.connect(dryGainL);
      splitR.connect(dryGainR);
      splitL.connect(delayL);
      splitR.connect(delayR);
      delayL.connect(chorusWetL);
      delayR.connect(chorusWetR);

      const merger = ctx.createChannelMerger(2);
      dryGainL.connect(merger, 0, 0);
      dryGainR.connect(merger, 0, 1);
      chorusWetL.connect(merger, 0, 0);
      chorusWetR.connect(merger, 0, 1);

      currentInput = merger;
      this._chorusNodes = [lfoL, lfoR, delayL, delayR, splitL, splitR, chorusWetL, chorusWetR, dryGainL, dryGainR, merger];
    }

    // Connect to compressor then master
    currentInput.connect(this._compressor);
  }

  /**
   * Apply a new effects configuration.
   */
  setConfig(config) {
    this._build(config);
  }

  /** Set master volume (0-1) */
  setMasterVolume(vol) {
    const now = this.ctx.currentTime;
    this._master.gain.setValueAtTime(Math.max(0, Math.min(1, vol)), now);
  }

  /**
   * Generate an impulse response buffer for reverb.
   * M1-inspired: dense early reflections + smooth exponential tail
   * with stereo variation for spatial depth.
   */
  _generateImpulseResponse(decay = 2, size = 0.5) {
    const { ctx } = this;
    const sampleRate = ctx.sampleRate;
    const duration = decay * (0.5 + size);
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);

      // ─── Early reflections (first ~80ms) ───
      // M1 reverb had distinctive early reflection patterns
      const earlyEnd = Math.floor(sampleRate * 0.08);
      const reflectionCount = 5 + Math.floor(size * 4);
      for (let r = 0; r < reflectionCount; r++) {
        const offset = Math.floor(earlyEnd * (r + 1) / (reflectionCount + 1));
        // Randomize reflection positions slightly per channel
        const jitter = Math.floor((ch === 0 ? 1 : -1) * sampleRate * 0.002 * (r % 2 === 0 ? 1 : -1));
        const pos = Math.max(0, Math.min(length - 1, offset + jitter));
        const amp = Math.pow(0.7, r) * (0.8 + Math.sin(r * 2.3 + ch * 1.7) * 0.2);
        // Deterministic noise for reproducibility
        const noise = Math.sin(pos * 12.9898 + r * 78.233 + ch * 43.12) * 43758.5453;
        const v = (noise - Math.floor(noise)) * 2 - 1;
        if (pos < length) {
          data[pos] += v * amp;
          // Spread each reflection over a few samples for density
          for (let s = 1; s < 8 && pos + s < length; s++) {
            const sNoise = Math.sin((pos + s) * 12.9898 + r * 78.233) * 43758.5453;
            const sv = (sNoise - Math.floor(sNoise)) * 2 - 1;
            data[pos + s] += sv * amp * (1 - s / 8);
          }
        }
      }

      // ─── Late diffuse tail ───
      // Exponentially decaying noise with frequency-dependent decay
      // (high frequencies decay faster — more natural)
      let i = earlyEnd;
      while (i < length) {
        const segmentLen = Math.min(64, length - i);
        for (let j = 0; j < segmentLen; j++) {
          const t = (i + j) / sampleRate;
          // Multi-stage decay: fast initial, then smooth exponential
          const earlyDecay = Math.exp(-t * 5 / decay);
          const lateDecay = Math.exp(-t * 2.5 / decay);
          const env = (t < 0.1 * duration) ? earlyDecay : lateDecay;
          // Frequency-dependent: highs fade faster
          const hfDamp = Math.exp(-t * 1.5 / decay);

          // Deterministic noise
          const noise = Math.sin(i * 12.9898 + j * 78.233 + ch * 37.7) * 43758.5453;
          const v = (noise - Math.floor(noise)) * 2 - 1;

          // Mix bright and damped noise for natural frequency rolloff
          const noise2 = Math.sin(i * 7.23 + j * 113.51 + ch * 19.3) * 23421.331;
          const v2 = (noise2 - Math.floor(noise2)) * 2 - 1;

          data[i + j] = (v * hfDamp + v2 * (1 - hfDamp) * 0.5) * env * (ch === 1 ? 0.95 : 1);
        }
        i += segmentLen;
      }
    }

    return buffer;
  }

  /**
   * Generate waveshaping curve for distortion.
   */
  _generateDistortionCurve(size, drive) {
    const curve = new Float32Array(size);
    const deg = Math.PI / 180;
    for (let i = 0; i < size; i++) {
      const x = (i * 2) / size - 1;
      // Soft clipping arctan-style with tube-like warmth
      const k = drive * 2;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      // Subtle even-harmonic warmth (asymmetric clipping simulates tubes)
      curve[i] += Math.sin(x * Math.PI) * 0.02 * drive;
    }
    return curve;
  }
}
