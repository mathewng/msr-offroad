/**
 * @file backtest-args.ts
 * @description CLI argument parsing for the backtest runner.
 */

import { CONFIG_BET2, CONFIG_EFFICIENCY, CONFIG_HIGHEST_YIELD } from "./config";
import type { BacktestConfig } from "./types";

export interface ParsedBacktestArgs {
    prevFile: string | undefined;
    currFile: string | undefined;
    config: BacktestConfig;
    showConfigOnly: boolean;
}

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

    const chunkSize = getFlagValue(args, "--chunk-size=");
    if (chunkSize !== undefined) {
        const v = parseInt(chunkSize, 10);
        if (!isNaN(v) && v > 0) c = { ...c, chunkSize: v };
    }

    const restarts = getFlagValue(args, "--restarts=");
    if (restarts !== undefined) {
        const v = parseInt(restarts, 10);
        if (!isNaN(v) && v > 0) c = { ...c, trainingRestarts: v };
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
 * --chunk-size=, --restarts=, --print-config-only, --diagnose-hmm.
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
