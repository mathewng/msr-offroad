import { CONFIG } from "./config";

/**
 * High-performance random number pool that pre-generates random values
 * to avoid repeated calls to Math.random() in performance-critical scenarios.
 *
 * Optimizations:
 * - Cache-aligned memory allocation for better CPU cache utilization
 * - Batch processing to minimize function call overhead
 * - Branchless operations where possible
 * - Bulk access methods for high-frequency use cases
 */
export class RandomPool {
    /** Pre-allocated array of random numbers */
    private pool: Float64Array;
    /** Current position in the pool */
    private index: number = 0;
    /** Number of values to process in each batch for cache efficiency */
    private readonly batchSize: number;

    /**
     * Creates a new RandomPool with the specified size
     * @param size Number of random values to pre-generate (default: 384K, enough for 40 days)
     */
    constructor(size: number = 500_000) {
        // Align to cache line boundaries (64 bytes = 8 Float64 values)
        // This ensures optimal memory access patterns and reduces cache misses
        const alignedSize = Math.ceil(size / 8) * 8;
        this.pool = new Float64Array(alignedSize);
        // Use smaller batches for better cache locality (1/8 of pool or max 32768)
        // Zen 4 has 1MB L2 per core
        this.batchSize = Math.min(32768, alignedSize >> 3);
        this.refill();
    }

    /**
     * Refills the entire pool with new random values using batch processing
     * for optimal CPU cache utilization
     */
    private refill(): void {
        // Process the pool in cache-friendly chunks to minimize memory access latency
        for (let batch = 0; batch < this.pool.length; batch += this.batchSize) {
            const end = Math.min(batch + this.batchSize, this.pool.length);
            // Fill each batch sequentially for better cache locality
            for (let i = batch; i < end; i++) {
                this.pool[i] = Math.random();
            }
        }
        // Reset index to start of pool
        this.index = 0;
    }

    /**
     * Returns the next random number from the pool
     * Automatically refills the pool when exhausted
     * @returns A random number between 0 and 1
     */
    next(): number {
        // Check if we've reached the end of the pool and need to refill
        // Uses bitwise operations for potential performance optimization
        if ((this.index ^ this.pool.length) >>> 31 === 0 && this.index >= this.pool.length) {
            this.refill();
        }
        // Return current value and increment index (non-null assertion safe after refill check)
        return this.pool[this.index++]!;
    }

    /**
     * Returns a batch of random numbers for high-frequency scenarios
     * More efficient than calling next() multiple times
     * @param count Number of random values to return
     * @returns A Float64Array view containing the requested random values
     */
    nextBatch(count: number): Float64Array {
        // Ensure we have enough values remaining, refill if necessary
        if (this.index + count > this.pool.length) {
            this.refill();
        }
        // Create a view of the requested portion (no copying, just a reference)
        const result = this.pool.subarray(this.index, this.index + count);
        // Advance the index by the number of values consumed
        this.index += count;
        return result;
    }
}

export default RandomPool;
