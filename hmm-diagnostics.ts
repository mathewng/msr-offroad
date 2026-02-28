/**
 * @file hmm-diagnostics.ts
 * @description HMM vs historical diagnostics: discrimination, entropy, agreement.
 */

import type { HmmDiagnostics } from "./types";
import { argMax } from "./utils";

/** Entropy of a discrete distribution (natural log). Uses 0 for 0*log(0). */
function entropy(probs: number[]): number {
    let h = 0;
    for (const p of probs) {
        if (p > 0) h -= p * Math.log(p);
    }
    return h;
}

/** Sample standard deviation. */
function sampleStd(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

export type DiagnosticSample = HmmDiagnostics & { winningSlot: number | null };

/**
 * Prints HMM vs historical diagnostics:
 * - HMM max-prob stats and entropy (flat vs peaked)
 * - Histogram of max HMM prob
 * - Agreement between HMM top slot and historical top slot
 * - When outcome is known: how often HMM top vs historical top matched the winner
 */
export function printHmmDiagnostics(samples: DiagnosticSample[]): void {
    const N = samples.length;
    const maxHmmProbs: number[] = [];
    const entropies: number[] = [];
    let agreementCount = 0;
    let withOutcome = 0;
    let hmmTopCorrect = 0;
    let histTopCorrect = 0;

    const BINS = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1];
    const numBins = BINS.length - 1;
    const binCounts = new Array(numBins).fill(0);

    for (const { hmmSlotProbs, histWinRates, winningSlot } of samples) {
        const maxHmm = Math.max(...hmmSlotProbs);
        const topHmmSlot = argMax(hmmSlotProbs) + 1;
        const topHistSlot = argMax(histWinRates) + 1;

        maxHmmProbs.push(maxHmm);
        entropies.push(entropy(hmmSlotProbs));

        if (topHmmSlot === topHistSlot) agreementCount++;

        if (winningSlot !== null) {
            withOutcome++;
            if (topHmmSlot === winningSlot) hmmTopCorrect++;
            if (topHistSlot === winningSlot) histTopCorrect++;
        }

        let bi = 0;
        while (bi < numBins - 1 && maxHmm >= BINS[bi + 1]!) bi++;
        binCounts[bi]++;
    }

    const meanMaxHmm = maxHmmProbs.reduce((a, b) => a + b, 0) / N;
    const stdMaxHmm = sampleStd(maxHmmProbs, meanMaxHmm);
    const meanEntropy = entropies.reduce((a, b) => a + b, 0) / N;
    const uniformEntropy = Math.log(6);

    console.log("\n" + "=".repeat(60));
    console.log("HMM DIAGNOSTICS");
    console.log("=".repeat(60));
    console.log(`Races with diagnostics: ${N}`);
    console.log("");
    console.log("HMM slot-probability distribution:");
    console.log(`  Max prob per race: mean = ${meanMaxHmm.toFixed(4)}, std = ${stdMaxHmm.toFixed(4)}`);
    console.log(`  (Uniform would give mean ≈ ${(1 / 6).toFixed(4)}; higher mean = more discriminating)`);
    console.log(`  Entropy (mean): ${meanEntropy.toFixed(4)} (uniform = ${uniformEntropy.toFixed(4)}; lower = more peaked)`);
    console.log("");
    console.log("Histogram of max HMM prob (per race):");
    for (let i = 0; i < numBins; i++) {
        const label = `[${BINS[i]!.toFixed(2)} - ${BINS[i + 1]!.toFixed(2)})`;
        const bar = "#".repeat(Math.min(40, binCounts[i]!));
        console.log(`  ${label.padEnd(14)} ${binCounts[i]!.toString().padStart(4)} ${bar}`);
    }
    console.log("");
    console.log("HMM vs Historical agreement (same top slot):");
    console.log(`  ${agreementCount} / ${N} (${((agreementCount / N) * 100).toFixed(1)}%)`);
    console.log("");
    if (withOutcome > 0) {
        console.log("When outcome known (top-slot accuracy):");
        console.log(`  HMM top slot was winner:  ${hmmTopCorrect} / ${withOutcome} (${((hmmTopCorrect / withOutcome) * 100).toFixed(1)}%)`);
        console.log(`  Historical top was winner: ${histTopCorrect} / ${withOutcome} (${((histTopCorrect / withOutcome) * 100).toFixed(1)}%)`);
    }
    console.log("=".repeat(60));
}
