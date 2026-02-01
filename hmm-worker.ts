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
    const { id, sequence, numStates, numObservations, iterations, tolerance, steps } = event.data;

    // 1. Initialize a new HMM with random parameters
    const hmm = new HMM(numStates, numObservations);

    // 2. Train the model using the Baum-Welch (EM) algorithm
    // This is the primary CPU-intensive operation.
    hmm.train(sequence, iterations, tolerance);

    // 3. Predict the next 'steps' (usually chunk size) observation probabilities
    const results = hmm.predictSteps(sequence, steps);

    // 4. Send the results (an array of Float64Arrays) back to the main thread
    self.postMessage({ id, results });
};
