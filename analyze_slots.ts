import { parseLines } from "./utils";

async function analyze() {
    const historicalData = await Bun.file("data_historical.txt").text();
    const currentData = await Bun.file("data_current.txt").text();

    const races = [...(await parseLines(historicalData.split("\n"))), ...(await parseLines(currentData.split("\n")))];

    console.log(`${"Slot".padEnd(6)} | ${"33rd P".padStart(8)} | ${"66th P".padStart(8)} | ${"Min".padStart(5)} | ${"Max".padStart(5)}`);
    console.log("- ".repeat(45));

    const getPercentile = (arr: number[], p: number) => {
        const idx = Math.floor((arr.length - 1) * p);
        return arr[idx];
    };

    const thresholds: Record<number, number[]> = {};

    for (let s = 1; s <= 6; s++) {
        const payouts = races.flatMap((r) => r.payouts[s - 1]);
        payouts.sort((a, b) => a - b);

        const p33 = getPercentile(payouts, 0.33);
        const p66 = getPercentile(payouts, 0.66);
        thresholds[s] = [p33, p66];

        console.log(
            `${s.toString().padEnd(6)} | ${p33.toFixed(1).padStart(8)} | ${p66.toFixed(1).padStart(8)} | ${payouts[0].toFixed(1).padStart(5)} | ${payouts[payouts.length - 1].toFixed(1).padStart(5)}`,
        );
    }

    console.log("\n--- Threshold Map for utils.ts ---");
    console.log(JSON.stringify(thresholds, null, 2));
}

analyze();
