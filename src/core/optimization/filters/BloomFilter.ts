/**
 * Bloom Filter Implementation
 *
 * Space-efficient probabilistic data structure for:
 * - Fast membership testing
 * - Entity existence checks
 * - Query result filtering
 */

import type { IBloomFilter } from "../interfaces/IOptimization.js";
import { createHash } from "node:crypto";

// =============================================================================
// Bloom Filter Configuration
// =============================================================================

export interface BloomFilterConfig {
  size: number;
  hashCount: number;
}

// =============================================================================
// Bloom Filter Implementation
// =============================================================================

export class BloomFilter implements IBloomFilter {
  private bits: Uint8Array;
  private size: number;
  private hashCount: number;
  private insertedCount = 0;

  constructor(config: BloomFilterConfig) {
    this.size = config.size;
    this.hashCount = config.hashCount;
    this.bits = new Uint8Array(Math.ceil(config.size / 8));
  }

  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      this.setBit(index);
    }
    this.insertedCount++;
  }

  addBatch(items: string[]): void {
    for (const item of items) {
      this.add(item);
    }
  }

  mightContain(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      if (!this.getBit(index)) {
        return false;
      }
    }
    return true;
  }

  estimatedCount(): number {
    return this.insertedCount;
  }

  falsePositiveRate(): number {
    // Calculate theoretical false positive rate
    // FPR = (1 - e^(-kn/m))^k
    // k = hash count, n = inserted count, m = size
    const k = this.hashCount;
    const n = this.insertedCount;
    const m = this.size;

    if (n === 0) return 0;

    const exponent = (-k * n) / m;
    const base = 1 - Math.exp(exponent);
    return Math.pow(base, k);
  }

  clear(): void {
    this.bits.fill(0);
    this.insertedCount = 0;
  }

  serialize(): Uint8Array {
    // Create header with metadata
    const header = new ArrayBuffer(12);
    const view = new DataView(header);
    view.setUint32(0, this.size, true);
    view.setUint32(4, this.hashCount, true);
    view.setUint32(8, this.insertedCount, true);

    // Combine header and bits
    const result = new Uint8Array(12 + this.bits.length);
    result.set(new Uint8Array(header), 0);
    result.set(this.bits, 12);

    return result;
  }

  deserialize(data: Uint8Array): void {
    if (data.length < 12) {
      throw new Error("Invalid bloom filter data");
    }

    const view = new DataView(data.buffer, data.byteOffset, 12);
    this.size = view.getUint32(0, true);
    this.hashCount = view.getUint32(4, true);
    this.insertedCount = view.getUint32(8, true);

    this.bits = data.slice(12);
  }

  // ==========================================================================
  // Static Helpers
  // ==========================================================================

  static optimalSize(expectedItems: number, falsePositiveRate: number): number {
    // m = -n * ln(p) / (ln(2)^2)
    return Math.ceil(
      (-expectedItems * Math.log(falsePositiveRate)) / Math.pow(Math.log(2), 2)
    );
  }

  static optimalHashCount(size: number, expectedItems: number): number {
    // k = (m/n) * ln(2)
    return Math.ceil((size / expectedItems) * Math.log(2));
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private getHashes(item: string): number[] {
    // Use double hashing technique
    // h(i) = h1 + i * h2
    const hash1 = this.hash(item, 0);
    const hash2 = this.hash(item, hash1);

    const hashes: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      hashes.push(Math.abs(hash1 + i * hash2));
    }

    return hashes;
  }

  private hash(item: string, seed: number): number {
    const data = `${seed}:${item}`;
    const digest = createHash("md5").update(data).digest();

    // Convert first 4 bytes to number
    return (
      (digest[0]! << 24) |
      (digest[1]! << 16) |
      (digest[2]! << 8) |
      digest[3]!
    ) >>> 0;
  }

  private setBit(index: number): void {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    this.bits[byteIndex]! |= 1 << bitIndex;
  }

  private getBit(index: number): boolean {
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    return (this.bits[byteIndex]! & (1 << bitIndex)) !== 0;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createBloomFilter(config: BloomFilterConfig): BloomFilter {
  return new BloomFilter(config);
}

export function createOptimalBloomFilter(
  expectedItems: number,
  falsePositiveRate: number
): BloomFilter {
  const size = BloomFilter.optimalSize(expectedItems, falsePositiveRate);
  const hashCount = BloomFilter.optimalHashCount(size, expectedItems);
  return new BloomFilter({ size, hashCount });
}
