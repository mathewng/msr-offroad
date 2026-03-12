import XGBoost from "../../node_modules/decision-tree/lib/xgboost.js";
import type { Race } from "../shared/types";
import { extractFeatures, raceToExamples } from "../shared/features";

export interface GBTModelData {
    modelJson: any;
}

/**
 * Trains a GBT model using historical race data.
 */
export function trainGBT(races: Race[], rates?: Record<number, number>, monsterRates?: Record<string, number>) {
    const trainingData = races.flatMap(r => raceToExamples(r, rates, monsterRates));
    
    if (trainingData.length === 0) {
        throw new Error("No training data available");
    }

    const features = Object.keys(trainingData[0]!).filter(k => k !== "won");
    const config = {
        nEstimators: 100,
        maxDepth: 5,
        learningRate: 0.1,
        objective: "regression" as const, // Use regression to get raw scores for probability
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
    rates?: Record<number, number>,
    monsterRates?: Record<string, number>
): number[] {
    const probs = race.payouts.map((_, i) => {
        const features = extractFeatures(race, i, rates, monsterRates);
        const score = gbt.predict(features);
        // Apply sigmoid to convert regression score to probability
        return 1 / (1 + Math.exp(-score));
    });

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
