import { HMM } from "./hmm";

/**
 * HMM Worker Script
 *
 * This file is executed within a background web worker thread. It is responsible
 * for the computationally expensive task of training a Hidden Markov Model (HMM)
 * on a sequence and generating future probabilities.
 *
 * Benefits:
 * - Offloads CPU-intensive operations from main thread to background workers
 * - Enables parallel processing of multiple HMM models simultaneously
 * - Processes large datasets efficiently without blocking UI updates
 */

declare var self: Worker;

/**
 * Listens for messages from the main thread.
 */
self.onmessage = (event: MessageEvent) => {
    // sequence is an Int32Array (likely backed by SharedArrayBuffer)
    const { id, sequence, numStates, numObservations, iterations, restarts, tolerance, smoothing, steps } = event.data;

    // 1. Initialize a new HMM with random parameters
    const hmm = new HMM(numStates, numObservations);

    // 2. Seed with global frequencies + random noise to improve convergence
    // while maintaining ensemble diversity.
    hmm.initializeFromData(sequence);

    // 3. Train the model using the Baum-Welch (EM) algorithm
    // This is the primary CPU-intensive operation.
    hmm.train(sequence, iterations, restarts, tolerance, smoothing);

    // 3. Predict the next 'steps' (usually chunk size) observation probabilities
    const results = hmm.predictSteps(sequence, steps);

    // 4. Find the most likely sequence of hidden states (Viterbi path)
    // This identifies the "regime" the system is currently in.
    const viterbiPath = hmm.viterbi(sequence);

    // 5. Send the results back to the main thread
    self.postMessage({ id, results, viterbiPath });
};
