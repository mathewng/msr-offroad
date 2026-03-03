import { HMM } from "../core/hmm";

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
    const { id, sequence, numStates, numObservations, iterations, restarts, tolerance, smoothing, steps, seedParams } =
        event.data;

    // 1. Initialize a new HMM with random parameters
    const hmm = new HMM(numStates, numObservations);

    // 2. Train the model using the Baum-Welch (EM) algorithm
    // Note: train() now internally handles initialization (either from seed or from data)
    hmm.train(sequence, iterations, restarts, tolerance, smoothing, seedParams);

    // 3. Predict the next 'steps' (usually chunk size) observation probabilities
    const results = hmm.predictSteps(sequence, steps);

    // 4. Find the most likely sequence of hidden states (Viterbi path)
    // This identifies the "regime" the system is currently in.
    const viterbiPath = hmm.viterbi(sequence);

    // 5. Get the final parameters to support warm starts in the next training round
    const params = hmm.getParameters();

    // 6. Send the results back to the main thread
    self.postMessage({ id, results, viterbiPath, params });
};
