import { loadRaces } from "../shared/utils";
import { trainGBT, saveGBTModel } from "../core/gbt-engine";

async function main() {
    const histFile = "data_historical.txt";
    const currFile = "data_current.txt";
    
    console.log("Loading race data...");
    const historicalRaces = await loadRaces(histFile);
    const currRaces = await loadRaces(currFile);
    const allRaces = [...historicalRaces,...currRaces].filter(r => r.winningSlot !== null);
    
    // Calculate win rates for feature engineering
    const { calculateEmpiricalWinRates } = await import("../shared/utils");
    const winRates = calculateEmpiricalWinRates(allRaces);

    // Calculate monster win rates
    const monsterCounts: Record<string, { wins: number, total: number }> = {};
    for (const r of allRaces) {
        if (r.winningSlot === null) continue;
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
    
    console.log(`Training on ${allRaces.length} all races...`);
    const gbt = trainGBT(allRaces, winRates, monsterRates);
    
    console.log("Model trained successfully.");
    
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
    await Bun.write("slots_won.json", JSON.stringify(winRates));
    console.log("Win rates saved to slots_won.json");

    await Bun.write("monsters_won.json", JSON.stringify(monsterRates));
    console.log("Monster rates saved to monsters_won.json");
}

main().catch(console.error);
