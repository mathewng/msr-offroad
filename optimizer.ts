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
async function runBacktest(params: BacktestParams): Promise<number> {
    // Run backtest multiple times and average the profit
    const profits = [];
    for (let i = 0; i < BACKTEST_RUNS; i++) {
        const profit = await runSingleBacktest(params);
        profits.push(profit);
    }

    // Calculate average profit
    const averageProfit = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    return averageProfit;
}

/** @description Runs a single instance of the backtest with given parameters and extracts profit from output */
async function runSingleBacktest(params: BacktestParams): Promise<number> {
    return new Promise((resolve, reject) => {
        // Build command arguments for backtest execution
        const args = ["data_historical.txt", "data_current.txt", `--historical-weight=${params.scoreWeights.historical}`, `--hmm-weight=${params.scoreWeights.hmm}`];

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

/**
 * Optimizes the settings for running backtest.ts by testing different combinations of parameters.
 */
/** @description Main optimization loop that tests all parameter combinations */
async function optimizeSettings() {
    // Define ranges for each parameter to test
    const betLimits = [1, 2, 3];
    const weightAdjustStep = 0.01;
    const weightAdjustRange = 0.6;
    const historicalWeights = Array.from({ length: fixPrecision(weightAdjustRange / weightAdjustStep) }, (_, i) => fixPrecision(1 - i * weightAdjustStep));

    // Initialize tracking variables for best results
    let bestParams: BacktestParams = {
        betLimit: 1,
        chunkSize: 3,
        scoreWeights: { historical: 0, hmm: 0 },
    };
    let highestProfit = -Infinity;

    // Test all combinations of parameters
    for (const betLimit of betLimits) {
        for (const chunkSize of [3, 6]) {
            for (const historicalWeight of historicalWeights) {
                const hmmWeight = fixPrecision(1 - historicalWeight);
                const params: BacktestParams = {
                    betLimit,
                    chunkSize,
                    scoreWeights: { historical: historicalWeight, hmm: hmmWeight },
                };

                try {
                    // Run backtest and capture profit
                    const profit = await runBacktest(params);
                    console.log(`Profit for ${JSON.stringify(params)}: ${profit}`);
                    console.log();

                    // Update best parameters if current profit is higher
                    if (profit > highestProfit) {
                        highestProfit = profit;
                        bestParams = params;
                    }
                } catch (error) {
                    console.error(`Error running backtest with params ${JSON.stringify(params)}:`, error);
                }
            }
        }
    }

    // Display final results
    console.log("Best parameters:", bestParams);
    console.log("Highest Profit:", highestProfit);
}

/** @description Entry point - starts the optimization process */
// Run the optimization
optimizeSettings();
