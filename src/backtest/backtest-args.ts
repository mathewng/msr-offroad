/**
 * @file backtest-args.ts
 * @description CLI argument parsing for the backtest runner.
 */

import { CONFIG_BET2, CONFIG_EFFICIENCY, CONFIG_HIGHEST_YIELD } from "../shared/config";
import type { BacktestConfig } from "../shared/types";

export interface ParsedBacktestArgs {
    prevFile: string | undefined;
    currFile: string | undefined;
    config: BacktestConfig;
    showConfigOnly: boolean;
}

export const BACKTEST_USAGE = `Usage: bun backtest.ts <historical_data> <target_data> [options]

Positional:
  <historical_data>   Path to historical race data (training set)
  <target_data>      Path to target race data (test set)

Strategy (pick one):
  --efficiency, -e, --eff   Maximize ROI (single bet, selective)
  --yield, -y              Maximize net profit (default, up to 3 bets)
  --bet2, -b2              Up to 2 bets per race

Overrides:
  --historical-weight=<n>   Weight for historical stats (0–1)
  --hmm-weight=<n>          Weight for HMM predictions (0–1)
  --min-score=<n>           Minimum score threshold to bet
  --relative-threshold=<n>  Edge over race average required
  --prior-weight=<n>        Prior strength for Laplace smoothing
  --hmm-smoothing=<n>       HMM re-estimation smoothing
  --restarts=<n>            HMM training restarts per model
  --bet-limit=<n>           Max bets per race (1–6)
  --ensemble-size=<n>       Number of HMM models in ensemble
  --iterations=<n>          Max Baum-Welch iterations per model
  --tolerance=<n>           Convergence tolerance for training
  --workers=<n>             Parallel worker threads
  --chunk-size=<n>          Number of races per retraining chunk
  --hmm-states=<n>          Number of HMM hidden states
  --perturb-amount=<n>      Warm-start perturbation (e.g. 0.2 for ±20%)

Other:
  --diagnose-hmm      Print HMM vs historical diagnostics at end
  --print-config-only Print config (with empirical win rates) and exit
`;

/** Returns the value after "=" for the first arg starting with prefix, or undefined. */
function getFlagValue(args: string[], prefix: string): string | undefined {
    const arg = args.find((a) => a.startsWith(prefix));
    if (!arg || !arg.includes("=")) return undefined;
    const value = arg.split("=")[1]?.trim();
    return value !== "" ? value : undefined;
}

function hasAnyFlag(args: string[], ...flags: string[]): boolean {
    return flags.some((f) => args.includes(f));
}

function selectBaseConfig(args: string[]): BacktestConfig {
    if (hasAnyFlag(args, "--efficiency", "--eff", "-eff", "-e")) return CONFIG_EFFICIENCY;
    if (hasAnyFlag(args, "--bet2", "-b2")) return CONFIG_BET2;
    return CONFIG_HIGHEST_YIELD;
}

function applyOverrides(args: string[], config: BacktestConfig): BacktestConfig {
    let c = config;

    const historicalWeight = getFlagValue(args, "--historical-weight=");
    const hmmWeight = getFlagValue(args, "--hmm-weight=");
    if (historicalWeight !== undefined || hmmWeight !== undefined) {
        c = { ...c, scoreWeights: { ...c.scoreWeights } };
        const wH = parseFloat(historicalWeight ?? "");
        if (!isNaN(wH)) c.scoreWeights!.historical = wH;
        const wHmm = parseFloat(hmmWeight ?? "");
        if (!isNaN(wHmm)) c.scoreWeights!.hmm = wHmm;
    }

    const minScore = getFlagValue(args, "--min-score=");
    if (minScore !== undefined) {
        const v = parseFloat(minScore);
        if (!isNaN(v)) c = { ...c, minScoreThreshold: v };
    }

    const relativeThreshold = getFlagValue(args, "--relative-threshold=");
    if (relativeThreshold !== undefined) {
        const v = parseFloat(relativeThreshold);
        if (!isNaN(v)) c = { ...c, relativeThreshold: v };
    }

    const priorWeight = getFlagValue(args, "--prior-weight=");
    if (priorWeight !== undefined) {
        const v = parseFloat(priorWeight);
        if (!isNaN(v)) c = { ...c, priorWeight: v };
    }

    const hmmSmoothing = getFlagValue(args, "--hmm-smoothing=");
    if (hmmSmoothing !== undefined) {
        const v = parseFloat(hmmSmoothing);
        if (!isNaN(v)) c = { ...c, hmmSmoothing: v };
    }

    const restarts = getFlagValue(args, "--restarts=");
    if (restarts !== undefined) {
        const v = parseInt(restarts, 10);
        if (!isNaN(v) && v > 0) c = { ...c, trainingRestarts: v };
    }

    const betLimit = getFlagValue(args, "--bet-limit=");
    if (betLimit !== undefined) {
        const v = parseInt(betLimit, 10);
        if (!isNaN(v) && v >= 1 && v <= 6) c = { ...c, betLimit: v };
    }

    const ensembleSize = getFlagValue(args, "--ensemble-size=");
    if (ensembleSize !== undefined) {
        const v = parseInt(ensembleSize, 10);
        if (!isNaN(v) && v > 0) c = { ...c, ensembleSize: v };
    }

    const iterations = getFlagValue(args, "--iterations=");
    if (iterations !== undefined) {
        const v = parseInt(iterations, 10);
        if (!isNaN(v) && v > 0) c = { ...c, trainingIterations: v };
    }

    const tolerance = getFlagValue(args, "--tolerance=");
    if (tolerance !== undefined) {
        const v = parseFloat(tolerance);
        if (!isNaN(v) && v > 0) c = { ...c, convergenceTolerance: v };
    }

    const workers = getFlagValue(args, "--workers=");
    if (workers !== undefined) {
        const v = parseInt(workers, 10);
        if (!isNaN(v) && v > 0) c = { ...c, maxWorkers: v };
    }

    const chunkSize = getFlagValue(args, "--chunk-size=");
    if (chunkSize !== undefined) {
        const v = parseInt(chunkSize, 10);
        if (!isNaN(v) && v > 0) c = { ...c, chunkSize: v };
    }

    const hmmStates = getFlagValue(args, "--hmm-states=");
    if (hmmStates !== undefined) {
        const v = parseInt(hmmStates, 10);
        if (!isNaN(v) && v > 0) c = { ...c, hmmStates: v };
    }

    const perturbAmount = getFlagValue(args, "--perturb-amount=");
    if (perturbAmount !== undefined) {
        const v = parseFloat(perturbAmount);
        if (!isNaN(v) && v >= 0) c = { ...c, perturbAmount: v };
    }

    if (hasAnyFlag(args, "--diagnose-hmm")) {
        c = { ...c, diagnoseHmm: true };
    }

    return c;
}

/**
 * Parses process.argv into file paths, config, and flags.
 *
 * Positional: 1) historical data file, 2) target data file.
 * Flags: --efficiency|--yield|--bet2, --historical-weight=, --hmm-weight=,
 * --min-score=, --relative-threshold=, --prior-weight=, --hmm-smoothing=,
 * --restarts=, --bet-limit=, --ensemble-size=, --iterations=,
 * --tolerance=, --workers=, --hmm-states=, --perturb-amount=, --print-config-only, --diagnose-hmm.
 */
export function parseBacktestArgs(): ParsedBacktestArgs {
    const args = process.argv.slice(2);
    const fileArgs = args.filter((a) => !a.startsWith("-"));
    const config = applyOverrides(args, selectBaseConfig(args));

    return {
        prevFile: fileArgs[0],
        currFile: fileArgs[1],
        config,
        showConfigOnly: hasAnyFlag(args, "--print-config-only", "-pco"),
    };
}
