import { getPayoutBucket } from "./utils";

interface PredictionResult {
    probs: Record<number, number>;
    confidence: number;
}

interface PerformanceTracker {
    slot: number[];
    enhanced: number[];
}

class VMM {
    constructor(
        private maxOrder: number = 4,
        private useFeatures: boolean = false,
        private minCount: number = 3,
    ) {}

    private encode(slot: number, payout: number): number {
        if (!this.useFeatures) return slot;
        const bucket = getPayoutBucket(payout, slot);
        return (slot - 1) * 3 + bucket;
    }

    private decodeSlot(obs: number): number {
        if (!this.useFeatures) return obs;
        return Math.floor(obs / 3) + 1;
    }

    public getSequence(races: any[]): number[] {
        return races.filter((r) => r.winningSlot !== null && r.winningPayout !== null).map((r) => this.encode(r.winningSlot!, r.winningPayout!));
    }

    private buildTransitions(sequence: number[], order: number): Record<string, Record<number, number>> {
        const transitions: Record<string, Record<number, number>> = {};
        for (let i = 0; i <= sequence.length - order - 1; i++) {
            const state = sequence.slice(i, i + order).join(",");
            const next = sequence[i + order]!;
            if (!transitions[state]) transitions[state] = {};
            transitions[state][next] = (transitions[state][next] || 0) + 1;
        }
        return transitions;
    }

    public getProbs(sequence: number[]): PredictionResult {
        if (sequence.length === 0) return { probs: {}, confidence: 0 };
        for (let order = Math.min(this.maxOrder, sequence.length); order >= 1; order--) {
            const transitions = this.buildTransitions(sequence, order);
            const currentState = sequence.slice(-order).join(",");
            const nextPossible = transitions[currentState];
            if (nextPossible) {
                const total = Object.values(nextPossible).reduce((a, b) => a + b, 0);
                if (total >= this.minCount) {
                    const slotProbs: Record<number, number> = {};
                    for (const [obsStr, count] of Object.entries(nextPossible)) {
                        const obs = parseInt(obsStr);
                        const slot = this.decodeSlot(obs);
                        const prob = (count as number) / total;
                        slotProbs[slot] = (slotProbs[slot] || 0) + prob;
                    }
                    const maxProb = Math.max(...Object.values(slotProbs));
                    const confidence = (maxProb * Math.sqrt(total)) / 3;
                    return { probs: slotProbs, confidence };
                }
            }
        }
        return { probs: {}, confidence: 0 };
    }
}

class EnsembleStrategy {
    private weightSlot: number;
    private weightEnhanced: number;
    private recentPerformance: PerformanceTracker = { slot: [], enhanced: [] };

    constructor(
        private modelSlot: VMM,
        private modelEnhanced: VMM,
        private config: any,
    ) {
        this.weightSlot = config.INITIAL_WEIGHT_SLOT;
        this.weightEnhanced = config.INITIAL_WEIGHT_ENHANCED;
    }

    public predict(
        histSeqSlot: number[],
        histSeqEnhanced: number[],
        currSeqSlot: number[],
        currSeqEnhanced: number[],
    ): {
        bets: number[];
        bestSlot: number;
        confidence: number;
        resultA: PredictionResult;
        resultB: PredictionResult;
    } {
        const resultA = this.modelSlot.getProbs([...histSeqSlot, ...currSeqSlot]);
        const resultB = this.modelEnhanced.getProbs([...histSeqEnhanced, ...currSeqEnhanced]);

        const combinedProbs: { slot: number; prob: number }[] = [];
        for (let s = 1; s <= 6; s++) {
            combinedProbs.push({
                slot: s,
                prob: (resultA.probs[s] || 0) * this.weightSlot + (resultB.probs[s] || 0) * this.weightEnhanced,
            });
        }

        combinedProbs.sort((a, b) => b.prob - a.prob);
        if (!combinedProbs[0]) return { bets: [], bestSlot: -1, confidence: 0, resultA, resultB };
        const bestSlot = combinedProbs[0].slot;

        const overallConfidence = resultA.confidence * this.weightSlot + resultB.confidence * this.weightEnhanced;

        // Hybrid Betting Logic:
        const bets: number[] = [];
        if (overallConfidence > this.config.CONFIDENCE_THRESHOLD) {
            bets.push(bestSlot);

            if (overallConfidence > (this.config.SECOND_BET_CONFIDENCE ?? 1.1) && combinedProbs.length > 1 && combinedProbs[1] && combinedProbs[1].prob > (this.config.SECOND_BET_PROB ?? 0.5)) {
                bets.push(combinedProbs[1].slot);
            }
        }

        return { bets, bestSlot, confidence: overallConfidence, resultA, resultB };
    }

    public updatePerformance(resultA: PredictionResult, resultB: PredictionResult, actualSlot: number): void {
        const slotCorrect = (resultA.probs[actualSlot] || 0) > this.config.PERFORMANCE_THRESHOLD ? 1 : 0;
        const enhancedCorrect = (resultB.probs[actualSlot] || 0) > this.config.PERFORMANCE_THRESHOLD ? 1 : 0;

        this.recentPerformance.slot.push(slotCorrect);
        this.recentPerformance.enhanced.push(enhancedCorrect);

        if (this.recentPerformance.slot.length > this.config.WINDOW_SIZE) {
            this.recentPerformance.slot.shift();
            this.recentPerformance.enhanced.shift();
        }

        this.adjustWeights();
    }

    private adjustWeights(): void {
        if (this.recentPerformance.slot.length >= this.config.MIN_PERFORMANCE_SAMPLES) {
            const slotAccuracy = this.recentPerformance.slot.reduce((a, b) => a + b, 0) / this.recentPerformance.slot.length;
            const enhancedAccuracy = this.recentPerformance.enhanced.reduce((a, b) => a + b, 0) / this.recentPerformance.enhanced.length;
            const total = slotAccuracy + enhancedAccuracy;

            if (total > 0) {
                this.weightSlot = this.config.MIN_WEIGHT + this.config.WEIGHT_RANGE * (slotAccuracy / total);
                this.weightEnhanced = 1 - this.weightSlot;
            }
        }
    }
}

async function simulate(historicalRaces: any[], currentRaces: any[], config: any) {
    const modelSlot = new VMM(4, false, 2);
    const modelEnhanced = new VMM(3, true, 2);
    const strategy = new EnsembleStrategy(modelSlot, modelEnhanced, config);

    const histSeqSlot = modelSlot.getSequence(historicalRaces);
    const histSeqEnhanced = modelEnhanced.getSequence(historicalRaces);

    let totalProfit = 0;
    let totalBets = 0;

    const currSeqSlot: number[] = [];
    const currSeqEnhanced: number[] = [];

    // Process races in sessions (chunks of 3)
    for (let i = 0; i < currentRaces.length; i += 3) {
        const chunk = currentRaces.slice(i, i + 3);
        const sessionPredictions: any[] = [];

        // 1. Prediction Phase
        let workingSeqSlot = [...currSeqSlot];
        let workingSeqEnhanced = [...currSeqEnhanced];

        for (let j = 0; j < chunk.length; j++) {
            const prediction = strategy.predict(histSeqSlot, histSeqEnhanced, workingSeqSlot, workingSeqEnhanced);
            sessionPredictions.push(prediction);

            workingSeqSlot.push(prediction.bestSlot);
            workingSeqEnhanced.push((prediction.bestSlot - 1) * 3 + 1);
        }

        // 2. Settlement Phase
        for (let j = 0; j < chunk.length; j++) {
            const race = chunk[j]!;
            const prediction = sessionPredictions[j];

            if (prediction.bets.length > 0 && race.winningSlot !== null && race.winningPayout !== null) {
                totalBets += prediction.bets.length;
                if (prediction.bets.includes(race.winningSlot)) {
                    totalProfit += race.winningPayout - prediction.bets.length;
                } else {
                    totalProfit -= prediction.bets.length;
                }
            }

            if (race.winningSlot !== null && race.winningPayout !== null) {
                if (prediction.bets.length > 0) {
                    strategy.updatePerformance(prediction.resultA, prediction.resultB, race.winningSlot);
                }

                currSeqSlot.push(race.winningSlot);
                currSeqEnhanced.push((race.winningSlot - 1) * 3 + getPayoutBucket(race.winningPayout, race.winningSlot));
            }
        }
    }

    return { totalProfit, totalBets, roi: totalBets > 0 ? totalProfit / totalBets : -1 };
}

// @ts-ignore
self.onmessage = async (e: MessageEvent) => {
    const { configs, historicalRaces, currentRaces } = e.data;
    const results = [];
    for (const config of configs) {
        const res = await simulate(historicalRaces, currentRaces, config);
        results.push({ ...config, ...res });
    }
    // @ts-ignore
    self.postMessage({ results });
};
