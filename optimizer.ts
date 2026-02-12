import { spawn } from "child_process";

interface BacktestParams {
    betLimit: number;
    chunkSize: number;
    scoreWeights: { historical: number; hmm: number };
}

const BACKTEST_RUNS = 5;
/**
 * Runs backtest.ts
 * and reads the console output to find the best settings for each betLimit: 1,2 and 3
 * - chunkSize: 3 or 6
 * - scoreWeights: starting from historical (1) and hmm (0) until hmm (0.6). historical+hmm must equal 1
 *
 * to maximise Profit
 * @param params The parameters for running backtest.ts
 */
async function runBacktest(params: BacktestParams, highestProfit: number): Promise<{ minProfit: number; maxProfit: number; averageProfit: number; stdDev: number; }> {
    // Run backtest multiple times and average the profit
    const profits = [];
    for (let i = 0; i < BACKTEST_RUNS; i++) {
        const profit = await runSingleBacktest(params);

        profits.push(profit);

        const averageProfit = profits.reduce((sum, p) => sum + p, 0) / profits.length;
        // if the gap to highest profit is too huge
        // no need to waste cpu cycles averaging..
        if (i === 0 && highestProfit - averageProfit > highestProfit * (1 / 3))
            break;
        else if (i >= 1 && highestProfit - averageProfit > highestProfit * (1 / 6))
            break;

        // if hmm is 0, the result is constant and does not vary
        // so a single run is enough
        if (params.scoreWeights.hmm === 0)
            break;
    }

    // Calculate average profit
    const averageProfit = profits.reduce((sum, p) => sum + p, 0) / profits.length;

    // Calculate max profit
    const maxProfit = Math.max(...profits);

    // Calculate min profit
    const minProfit = Math.min(...profits);

    const _stdDev = stdDev(...profits);

    return { minProfit, maxProfit, averageProfit, stdDev: _stdDev };
}

/** @description Runs a single instance of the backtest with given parameters and extracts profit from output */
async function runSingleBacktest(params: BacktestParams): Promise<number> {
    return new Promise((resolve, reject) => {
        // Build command arguments for backtest execution
        const args = ["data_historical.txt", "data_current.txt", `--historical-weight=${params.scoreWeights.historical}`, `--hmm-weight=${params.scoreWeights.hmm}`, `--chunk-size=${params.chunkSize}`];

        // Add bet limit flag based on params.betLimit value
        if (params.betLimit === 1) {
            args.push(`--efficiency`);
        } else if (params.betLimit === 2) {
            args.push(`--bet2`);
        } else {
            // Default to yield for betLimit 3
            args.push(`--yield`);
        }

        console.log(`Executing "bun backtest.ts ${args.join(" ")}"`);
        // Spawn backtest process in project directory
        const backtestProcess = spawn("bash", ["-c", `bun backtest.ts ${args.join(" ")}`], {
            cwd: "/home/mathew/Development/Github/msr-offroad",
        });

        // Capture stdout and stderr from the process
        let output = "";
        backtestProcess.stdout.on("data", (data) => {
            output += data.toString();
        });

        // Log any errors to console
        backtestProcess.stderr.on("data", (data) => {
            console.error(`stderr: ${data}`);
        });

        // Handle process completion and extract profit from output
        backtestProcess.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`backtest.ts exited with code ${code}`));
                return;
            }

            // Extract Profit value using regex pattern matching
            const profitMatch = output.match(/Profit:\s+(\d+(\.\d+)?)?/);
            if (profitMatch === null) {
                reject(new Error("Profit value not found in backtest output"));
                return;
            }

            // Parse and return the profit value
            resolve(parseFloat(profitMatch?.[1] ?? "0"));
        });
    });
}

/** @description Avoid binary floating-point format issues. Ensures consistent precision by rounding to 10 decimal places */
function fixPrecision(val: number) {
    return parseFloat(val.toFixed(10));
}
function stdDev(...numbers: number[]): number {
    const n = numbers.length;
    if (n === 0) return 0;

    const mean = numbers.reduce((a, b) => a + b, 0) / n;

    const squaredDiffs = numbers.map(num => Math.pow(num - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n;  // Population variance

    return Math.sqrt(variance);  // Population std dev
}
/**
 * Optimizes the settings for running backtest.ts by testing different combinations of parameters.
 */
/** @description Main optimization loop that tests all parameter combinations */
async function optimizeSettings() {
    // Define ranges for each parameter to test
    const betLimits = [1, 2, 3];
    const weightAdjustStep = 0.01;
    // const weightAdjustRange = 0.6;
    const weightAdjustRange = 1;
    const historicalWeights = Array.from({ length: fixPrecision(weightAdjustRange / weightAdjustStep) }, (_, i) => fixPrecision(1 - i * weightAdjustStep));

    // Initialize tracking variables for best results
    let bestMaxParams: BacktestParams = {
        betLimit: 1,
        chunkSize: 3,
        scoreWeights: { historical: 0, hmm: 0 },
    };
    let bestAverageParams: BacktestParams = {
        betLimit: 1,
        chunkSize: 3,
        scoreWeights: { historical: 0, hmm: 0 },
    };
    let highestMaxProfit: number;
    let highestAverageProfit: number;

    let results: {
        type: 'max profit' | 'average profit'
        betLimit: number;
        params: BacktestParams;
        profit: number;
    }[] = [];

    // Test all combinations of parameters
    for (const betLimit of betLimits) {
        highestMaxProfit = -Infinity;
        highestAverageProfit = -Infinity;

        for (const historicalWeight of historicalWeights) {
            for (const chunkSize of [3, 6]) {
                const hmmWeight = fixPrecision(1 - historicalWeight);
                const params: BacktestParams = {
                    betLimit,
                    chunkSize,
                    scoreWeights: { historical: historicalWeight, hmm: hmmWeight },
                };

                try {
                    // Run backtest and capture profit
                    const { minProfit, maxProfit, averageProfit, stdDev: _stdDev } = await runBacktest(params, highestMaxProfit);
                    console.log(`Profit for ${JSON.stringify(params)}: min: ${minProfit} max: ${maxProfit} average: ${averageProfit.toFixed(1)} std dev: ${_stdDev.toFixed(2)}`);
                    console.log();

                    // Update best parameters if current profit is higher
                    if (maxProfit > highestMaxProfit) {
                        highestMaxProfit = maxProfit;
                        bestMaxParams = params;
                        results = results.filter(r => (r.betLimit !== betLimit) || (r.betLimit === betLimit && r.type !== 'max profit') || (r.betLimit === betLimit && r.type === 'max profit' && r.profit === highestMaxProfit));
                        results.push({
                            type: 'max profit',
                            betLimit,
                            params,
                            profit: maxProfit,
                        });
                    }
                    if (averageProfit > highestAverageProfit) {
                        highestAverageProfit = averageProfit;
                        bestAverageParams = params;
                        results = results.filter(r => (r.betLimit !== betLimit) || (r.betLimit === betLimit && r.type !== 'average profit') || (r.betLimit === betLimit && r.type === 'average profit' && r.profit === highestAverageProfit));
                        results.push({
                            type: 'average profit',
                            betLimit,
                            params,
                            profit: averageProfit,
                        });
                    }
                } catch (error) {
                    console.error(`Error running backtest with params ${JSON.stringify(params)}:`, error);
                }
            }
        }

        // Display final results
        console.log(new Array(120).fill('-').join(''));
        console.log(`Best parameters for bet limit=${betLimit}:`, bestMaxParams);
        console.log("Highest Max Profit:", highestMaxProfit);
        console.log();
        console.log(`Best parameters for bet limit=${betLimit}:`, bestAverageParams);
        console.log("Highest Average Profit:", highestAverageProfit.toFixed(1));
        console.log();
    }

    for (const { type, betLimit, params, profit } of results) {
        console.log(`Best parameters for bet limit=${betLimit}:`, params);
        if (type === 'average profit') {
            console.log("Highest Average  Profit:", profit.toFixed(1));
        } else if (type === 'max profit') {
            console.log("Highest Max Profit:", profit);
        }

        console.log();
    }
}

/** @description Entry point - starts the optimization process */
// Run the optimization
optimizeSettings();
