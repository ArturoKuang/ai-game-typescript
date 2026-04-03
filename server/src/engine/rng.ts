/**
 * Seeded pseudo-random number generator using xorshift128.
 * Produces deterministic sequences for reproducible tests.
 */
export class SeededRNG {
  /** 128-bit internal state (four 32-bit words) for the xorshift128 algorithm. */
  private s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    // Initialize state using splitmix32
    let z = (seed | 0) >>> 0;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z ^ (z >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      this.s[i] = t >>> 0;
    }
    // Ensure state is not all zeros
    if (
      this.s[0] === 0 &&
      this.s[1] === 0 &&
      this.s[2] === 0 &&
      this.s[3] === 0
    ) {
      this.s[0] = 1;
    }
  }

  /** Returns a float in [0, 1) */
  next(): number {
    const t = this.s[0] ^ (this.s[0] << 11);
    this.s[0] = this.s[1];
    this.s[1] = this.s[2];
    this.s[2] = this.s[3];
    this.s[3] = (this.s[3] ^ (this.s[3] >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.s[3] / 0x100000000;
  }

  /** Returns an integer in [0, max) */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Returns a random element from the array */
  pick<T>(arr: T[]): T {
    return arr[this.nextInt(arr.length)];
  }

  /** Fisher-Yates shuffle (in place, returns same array) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}
