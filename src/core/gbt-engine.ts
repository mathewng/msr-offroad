import XGBoost from "../../node_modules/decision-tree/lib/xgboost.js";
import type { Race, StatsResult } from "../shared/types";
import { extractFeatures, raceToExamples } from "../shared/features";

export interface GBTModelData {
    modelJson: any;
}

/**
 * Trains a GBT model using historical race data.
 */
export function trainGBT(races: Race[], stats?: StatsResult, monsterRates?: Record<string, number>) {
    const trainingData = races.flatMap(r => raceToExamples(r, stats, monsterRates));
    
    if (trainingData.length === 0) {
        throw new Error("No training data available");
    }

    const features = Object.keys(trainingData[0]!).filter(k => k !== "won");
    const config = {
        nEstimators: 250,
        maxDepth: 8,
        learningRate: 0.05,
        objective: "regression" as const, 
    };

    const gbt = new XGBoost("won", features, config);
    gbt.train(trainingData);
    
    return gbt;
}

/**
 * Predicts win probabilities for all slots in a race.
 */
export function predictGBT(
    gbt: any, 
    race: Race, 
    stats?: StatsResult,
    monsterRates?: Record<string, number>
): number[] {
    const rawScores = race.payouts.map((_, i) => {
        const features = extractFeatures(race, i, stats, monsterRates);
        return Math.max(0, gbt.predict(features)); // Ensure non-negative
    });

    // Simple normalization to convert raw regression scores to probabilities that sum to 1
    const sumScores = rawScores.reduce((a, b) => a + b, 0);
    const probs = rawScores.map(s => s / (sumScores || 1));

    return probs;
}

/**
 * Saves a trained model to a JSON file.
 */
export async function saveGBTModel(gbt: any, filePath: string) {
    const json = gbt.toJSON();
    await Bun.write(filePath, JSON.stringify(json));
}

/**
 * Loads a model from a JSON file.
 */
export async function loadGBTModel(filePath: string) {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return null;
    }
    const json = await file.json();
    const features = json.features;
    const config = json.config;
    
    const gbt = new XGBoost(json.target, features, config);
    gbt.import(json);
    return gbt;
}
