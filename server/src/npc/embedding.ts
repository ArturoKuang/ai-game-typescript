/**
 * Embedding utilities used by the NPC memory system.
 *
 * `MemoryManager` depends on the abstract {@link Embedder} interface so tests
 * and fallback mode can run without an external embedding service. The current
 * runtime uses {@link PlaceholderEmbedder}, which gives deterministic vectors
 * good enough for ranking and reproducible tests.
 */
export interface Embedder {
  /** Returns a vector of the configured dimension. */
  embed(text: string): Promise<number[]>;
  readonly dimension: number;
}

/**
 * Deterministic hash-based pseudo-embedder for testing.
 * Same text always produces the same vector. Cosine similarity
 * between different texts will be roughly random but consistent.
 * No external API needed.
 */
export class PlaceholderEmbedder implements Embedder {
  readonly dimension: number;

  constructor(dimension = 1536) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    // Simple hash-based seeding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      hash = ((hash << 5) - hash + ch) | 0;
    }

    // Generate deterministic vector using splitmix32
    const vec: number[] = [];
    let z = hash >>> 0 || 1;
    for (let i = 0; i < this.dimension; i++) {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z ^ (z >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      // Normalize to [-1, 1]
      vec.push(((t >>> 0) / 0x100000000) * 2 - 1);
    }

    // Normalize to unit length
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }
}

/** Cosine similarity helper shared by retrieval code and the in-memory store. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
