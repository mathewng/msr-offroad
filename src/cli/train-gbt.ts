import { loadRaces, calculateStats } from "../shared/utils";
import { trainGBT, saveGBTModel } from "../core/gbt-engine";
import { raceToExamples } from "../shared/features";
import type { BacktestConfig } from "../shared/types";

const defaultConfig: BacktestConfig = {
    betLimit: 2,
    ensembleSize: 10,
    chunkSize: 50,
    trainingIterations: 100,
    trainingRestarts: 3,
    convergenceTolerance: 0.001,
    maxWorkers: 4,
    hmmStates: 6,
    hmmObservations: 18,
    scoreWeights: { historical: 0.5, hmm: 0.5 },
    minScoreThreshold: 0.15,
    priorWeight: 0.1,
};

async function main() {
    const args = process.argv.slice(2);
    const files = args.length > 0 ? args : ["data_historical.txt"];

    console.log(`Loading training data from: ${files.join(", ")}...`);

    let trainingRaces: any[] = [];
    for (const f of files) {
        const races = await loadRaces(f);
        const seen = races.filter((r) => r.winningSlot !== null);
        trainingRaces = trainingRaces.concat(seen);
    }

    if (trainingRaces.length === 0) {
        console.error("No training data found (races with winning slots).");
        return;
    }

    // Calculate full stats for feature engineering ONLY using training data
    const stats = calculateStats(trainingRaces, defaultConfig);

    // Calculate monster win rates ONLY using training data
    const monsterCounts: Record<string, { wins: number; total: number }> = {};
    for (const r of trainingRaces) {
        for (let i = 0; i < 6; i++) {
            const m = r.players?.[i] ?? "Human";
            if (!monsterCounts[m]) monsterCounts[m] = { wins: 0, total: 0 };
            monsterCounts[m]!.total++;
            if (i + 1 === r.winningSlot) monsterCounts[m]!.wins++;
        }
    }
    const monsterRates: Record<string, number> = {};
    for (const [m, c] of Object.entries(monsterCounts)) {
        monsterRates[m] = (c.wins + 0.1) / (c.total + 0.6);
    }

    console.log(`Training on ${trainingRaces.length} races...`);
    const trainingData = trainingRaces.flatMap((r) => raceToExamples(r, stats, monsterRates));
    const gbt = trainGBT(trainingRaces, stats, monsterRates);

    console.log("Model trained successfully.");

    const trainingAccuracy = gbt.evaluate(trainingData);
    console.log(`Training Accuracy: ${(trainingAccuracy * 100).toFixed(2)}%`);

    const importance = gbt.getFeatureImportance();
    console.log("\n--- Feature Importance ---");
    Object.entries(importance)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .forEach(([name, score]) => {
            console.log(`${name.padEnd(15)}: ${score}`);
        });

    const modelPath = "gbt_model.json";
    await saveGBTModel(gbt, modelPath);
    console.log(`\nModel saved to ${modelPath}`);

    // Save rates for backtest-gbt
    await Bun.write("slots_won.json", JSON.stringify(stats));
    console.log("Full stats saved to slots_won.json");

    await Bun.write("monsters_won.json", JSON.stringify(monsterRates));
    console.log("Monster rates saved to monsters_won.json");
}

main().catch(console.error);
