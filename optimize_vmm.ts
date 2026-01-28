import { parseLines } from "./utils";
import { WorkerPool } from "./worker-pool";
import os from "os";

async function main() {
    console.log("Loading data...");
    const historicalData = await Bun.file("data_both.txt").text();
    const currentData = await Bun.file("data_current.txt").text();

    const historicalRaces = await parseLines(historicalData.split("\n"));
    const currentRaces = await parseLines(currentData.split("\n"));

    // Grid search ranges
    // const confidenceThresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    // const windowSizes = [5, 10, 15, 20, 25, 30, 35, 40];
    // const initialWeightSlots = [0.4, 0.5, 0.6, 0.7, 0.8];
    // const minWeights = [0.1, 0.2, 0.3, 0.4, 0.5];
    // const weightRanges = [0.3, 0.4, 0.5, 0.6, 0.7];
    // const performanceThresholds = [0.12, 0.16, 0.2, 0.24, 0.28, 0.32];
    // const minPerformanceSamples = [3, 5, 10, 15, 20, 25];
    const confidenceThresholds = [0.1, 0.2, 0.3];
    const windowSizes = [6, 9, 12, 15, 18, 21, 24];
    const initialWeightSlots = [0.3, 0.4, 0.5, 0.6, 0.7];
    const minWeights = [0.1, 0.2, 0.3];
    const weightRanges = [1.3, 1.4, 1.5];
    const performanceThresholds = [0.09, 0.1, 0.11];
    const minPerformanceSamples = [0, 1];
    const secondBetConfidences = [0, 0.1, 0.2];
    const secondBetProbs = [0.1, 0.2, 0.3];

    let bestConfig = null;
    let maxProfit = -Infinity;

    const allConfigs = [];
    for (const ct of confidenceThresholds) {
        for (const ws of windowSizes) {
            for (const iws of initialWeightSlots) {
                for (const mw of minWeights) {
                    for (const wr of weightRanges) {
                        for (const pt of performanceThresholds) {
                            for (const mps of minPerformanceSamples) {
                                for (const sbc of secondBetConfidences) {
                                    for (const sbp of secondBetProbs) {
                                        allConfigs.push({
                                            CONFIDENCE_THRESHOLD: ct,
                                            WINDOW_SIZE: ws,
                                            INITIAL_WEIGHT_SLOT: iws,
                                            INITIAL_WEIGHT_ENHANCED: 1 - iws,
                                            MIN_WEIGHT: mw,
                                            WEIGHT_RANGE: wr,
                                            PERFORMANCE_THRESHOLD: pt,
                                            MIN_PERFORMANCE_SAMPLES: mps,
                                            SECOND_BET_CONFIDENCE: sbc,
                                            SECOND_BET_PROB: sbp,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    const totalCombinations = allConfigs.length;
    const numWorkers = 4; // os.cpus().length;
    console.log(`Starting parallel grid search on ${numWorkers} cores for ${totalCombinations} combinations...`);

    const pool = new WorkerPool(numWorkers, "./vmm-optimizer-worker.ts");

    // Batch size to balance between communication overhead and worker utilization
    const batchSize = Math.ceil(totalCombinations / (numWorkers * 10));
    const batches = [];
    for (let i = 0; i < allConfigs.length; i += batchSize) {
        batches.push(allConfigs.slice(i, i + batchSize));
    }

    let completedConfigs = 0;
    const startTime = Date.now();

    // Progress reporting timer - every 3 seconds
    const progressInterval = setInterval(() => {
        if (completedConfigs === 0) return;
        const elapsed = (Date.now() - startTime) / 1000;
        const configsPerSec = completedConfigs / elapsed;
        const remaining = (totalCombinations - completedConfigs) / configsPerSec;
        process.stdout.write(
            `\rProgress: ${((completedConfigs / totalCombinations) * 100).toFixed(1)}% | ${completedConfigs}/${totalCombinations} | Rate: ${configsPerSec.toFixed(0)}/s | ETA: ${remaining.toFixed(1)}s    `,
        );
    }, 3000);

    const promises = batches.map(async (batch) => {
        const results = await pool.run({
            configs: batch,
            historicalRaces,
            currentRaces,
        });

        // @ts-ignore
        for (const result of results) {
            if (result.totalProfit > maxProfit) {
                maxProfit = result.totalProfit;
                bestConfig = result;
                process.stdout.write(`\r[NEW BEST] Profit: ${maxProfit.toFixed(2)} | ROI: ${(result.roi * 100).toFixed(2)}% | Bets: ${result.totalBets}    \n`);
                // console.log("Best Configuration Found:");
                // console.log(JSON.stringify(bestConfig, null, 2));
            }
        }

        completedConfigs += batch.length;
    });

    await Promise.all(promises);
    clearInterval(progressInterval);
    pool.terminate();

    console.log("\n\n=== PARALLEL GRID SEARCH COMPLETE ===");
    console.log("Best Configuration Found:");
    console.log(JSON.stringify(bestConfig, null, 2));
}

main().catch(console.error);
