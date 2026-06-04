/**
 * Live prediction CLI for Context EV Predictor.
 * Scores unseen races using historical data only.
 */

import { predictContextRace } from "../core/context-engine";
import { CONFIG_CONTEXT, CONFIG_CONTEXT_CONSERVATIVE } from "../shared/config";
import { contextConfigFromBacktest } from "../shared/context-types";
import { calculateContextStats } from "../shared/context-stats";
import { monsterDisplayName } from "../shared/monster-tiers";
import type { Race } from "../shared/types";
import { calculateEmpiricalWinRates, loadRaces } from "../shared/utils";

const USAGE = `Usage: bun src/cli/predict-race.ts [--hist <file>] [--curr <file>] [--file <all>] [--conservative] [--verbose] [--json]`;

function parseArgs(): {
    histFile: string;
    currFile: string;
    singleFile: string | undefined;
    conservative: boolean;
    verbose: boolean;
    json: boolean;
} {
    const args = process.argv.slice(2);
    let histFile = "data_historical.txt";
    let currFile = "data_current.txt";
    let singleFile: string | undefined;
    let conservative = false;
    let verbose = false;
    let json = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--hist" && args[i + 1]) histFile = args[++i]!;
        else if (a === "--curr" && args[i + 1]) currFile = args[++i]!;
        else if (a === "--file" && args[i + 1]) singleFile = args[++i];
        else if (a === "--conservative") conservative = true;
        else if (a === "--verbose") verbose = true;
        else if (a === "--json") json = true;
        else if (a === "--help" || a === "-h") {
            console.log(USAGE);
            process.exit(0);
        }
    }

    return { histFile, currFile, singleFile, conservative, verbose, json };
}

function isUnseenRace(r: Race): boolean {
    return r.winningSlot === null || r.isUnseen === true;
}

function printRacePrediction(race: Race, result: ReturnType<typeof predictContextRace>): void {
    console.log(`\nVenue: ${race.venue ?? "?"} | Round ${race.raceNumber} | Time: ${race.time}`);
    console.log(`${"Slot".padStart(4)} ${"Monster".padEnd(18)} ${"Payout".padStart(6)} ${"WinRate".padStart(8)} ${"EV".padStart(8)} ${"Bet?".padStart(5)}`);
    console.log("-".repeat(55));

    const betSet = new Set(result.bets);
    const bySlot = new Map(result.candidates.map((c) => [c.slot, c]));
    const diagBySlot = new Map(result.diagnostics?.map((d) => [d.slot, d]) ?? []);

    for (let s = 1; s <= 6; s++) {
        const c = bySlot.get(s);
        const d = diagBySlot.get(s);
        const payout = race.payouts[s - 1] ?? 0;
        const monster = monsterDisplayName(race.players, s - 1);
        const winRate = c?.winRate ?? d?.blendedWinRate ?? 0;
        const ev = c?.score ?? d?.ev ?? -Infinity;
        const bet = betSet.has(s) ? "*" : "";
        const wr = Number.isFinite(winRate) ? `${(winRate * 100).toFixed(1)}%` : "—";
        const evStr = Number.isFinite(ev) ? (ev >= 0 ? "+" : "") + ev.toFixed(2) : "—";
        console.log(`${String(s).padStart(4)} ${monster.padEnd(18)} ${payout.toFixed(1).padStart(6)} ${wr.padStart(8)} ${evStr.padStart(8)} ${bet.padStart(5)}`);
        if (d && result.diagnostics) {
            console.log(`       ctx=${d.contextSource} (${(d.contextRate * 100).toFixed(1)}%) monster=${d.monsterSource} n=${d.monsterOccurrences}`);
        }
    }

    if (result.bets.length > 0) {
        console.log(`Recommended: ${result.bets.map((b) => `S${b}`).join(", ")} (${result.bets.length} unit${result.bets.length > 1 ? "s" : ""})`);
    } else {
        console.log("Recommended: no bet (no slot meets threshold)");
    }
}

async function main(): Promise<void> {
    const { histFile, currFile, singleFile, conservative, verbose, json } = parseArgs();
    const baseConfig = conservative ? CONFIG_CONTEXT_CONSERVATIVE : CONFIG_CONTEXT;
    const config = { ...contextConfigFromBacktest(baseConfig), verbose };

    let seen: Race[] = [];
    let unseen: Race[] = [];

    if (singleFile) {
        const all = await loadRaces(singleFile);
        seen = all.filter((r) => !isUnseenRace(r));
        unseen = all.filter((r) => isUnseenRace(r));
    } else {
        const hist = await loadRaces(histFile);
        const curr = await loadRaces(currFile);
        seen = [...hist, ...curr.filter((r) => !isUnseenRace(r))];
        unseen = curr.filter((r) => isUnseenRace(r));
    }

    if (seen.length === 0) {
        console.error("No resolved races for training stats.");
        process.exit(1);
    }

    config.empiricalWinRates = calculateEmpiricalWinRates(seen);
    const stats = calculateContextStats(seen, config);

    if (unseen.length === 0) {
        console.log("No unseen races found. Use data with blank Win columns or --file with pending rows.");
        process.exit(0);
    }

    console.log(`Context EV Predictor — ${seen.length} training races, ${unseen.length} to predict`);

    const outputs: { race: Race; result: ReturnType<typeof predictContextRace> }[] = [];
    for (const race of unseen) {
        const result = predictContextRace(race, stats, config);
        outputs.push({ race, result });
        if (!json) printRacePrediction(race, result);
    }

    if (json) {
        console.log(
            JSON.stringify(
                outputs.map(({ race, result }) => ({
                    venue: race.venue,
                    round: race.raceNumber,
                    time: race.time,
                    date: race.date,
                    bets: result.bets,
                    candidates: result.candidates,
                    diagnostics: result.diagnostics,
                })),
                null,
                2,
            ),
        );
    }
}

main().catch(console.error);
