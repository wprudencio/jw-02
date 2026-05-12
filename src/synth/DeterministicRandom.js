/**
 * DeterministicRandom — Seeded PRNG using Mulberry32.
 * All methods are pure functions of the internal seed state.
 */
export class DeterministicRandom {
  constructor(seed) {
    this._seed = seed >>> 0;
  }

  /** Reset the generator with a new seed */
  reseed(seed) {
    this._seed = seed >>> 0;
  }

  /**
   * Generate next float in [0, 1).
   * Mulberry32 algorithm.
   */
  next() {
    let t = (this._seed += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max) */
  nextFloat(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] (inclusive) */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Pick a random element from an array */
  pick(arr) {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  /** Weighted pick: items is array of {value, weight} objects */
  weightedPick(items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let r = this.next() * total;
    for (const item of items) {
      r -= item.weight;
      if (r <= 0) return item.value;
    }
    return items[items.length - 1].value;
  }

  /** Approximate Gaussian using Box-Muller */
  nextGaussian(mean = 0, std = 1) {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
  }

  /** Clamped Gaussian output */
  nextClampedGaussian(mean, std, min, max) {
    let val;
    let attempts = 0;
    do {
      val = this.nextGaussian(mean, std);
      attempts++;
    } while ((val < min || val > max) && attempts < 20);
    return Math.max(min, Math.min(max, val));
  }

  /** Generate a random hash string (8 chars alphanumeric) */
  static generateHash() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let hash = '';
    // Use crypto random for initial hash generation
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    for (let i = 0; i < 8; i++) {
      hash += chars[array[i] % chars.length];
    }
    // Format as XXXX XXXX
    return hash.slice(0, 4) + hash.slice(4, 8);
  }

  /** Convert a hash string to a numeric seed */
  static hashToSeed(hash) {
    const str = hash.toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    let seed = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      seed = ((seed << 5) - seed) + code;
      seed = seed & seed; // Convert to 32-bit integer
    }
    return Math.abs(seed) >>> 0;
  }
}
