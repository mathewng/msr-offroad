type RaceTime = "12:00" | "18:00" | "12pm" | "6pm";

type Bet = {
    slot: number;
    cost: number;
};

type Race = {
    day: number;
    venue?: string;
    time: RaceTime;
    raceNumber: number;
    payouts: number[];
    bets: Bet[];
    winningSlot: 1 | 2 | 3 | 4 | 5 | 6;
    winningPayout: number;
};

type ProfitResults = {
    cost: number;
    profit: number;
    profitablity: number;
    winningRate: number;
    totalWins: number;
    totalBets: number;
    totalRaces: number;
};

async function main() {
    const firstArg = process.argv.slice(2)[0];
    if (!firstArg) {
        console.error("Please provide a file path");
        process.exit(1);
    }
    console.group(`processing ${firstArg}`);

    const data = await Bun.file(firstArg).text();
    const lines = data.split("\n");

    const races = await parseLines(lines);

    {
        console.log(`
 * Bet slot 2 and 5 for 12pm and 6pm`);
        clearBets(races);
        await generateBetsStrategyA(races);
        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Bet slot 2 and 4 for 12pm and 6pm`);
        clearBets(races);
        await generateBetsStrategyB(races);
        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Bet slot 2, 4 and 5 for 12pm and 6pm`);
        clearBets(races);
        await generateBetsStrategyC(races);
        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Bet slot 2 for 12pm and 6pm`);
        clearBets(races);
        await generateBetsStrategyD(races);

        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Bet slot 4,5,6 for 12pm and 6pm`);
        clearBets(races);
        await generateBetsStrategyE(races);

        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Bet round 1 for 2nd and 3rd round`);
        clearBets(races);
        await generateBetsStrategyF(races);

        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Bet round 1 for 2nd and 3rd round
 * Bet round 2 for 3rd round`);
        clearBets(races);
        await generateBetsStrategyG(races);

        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }

    console.log();
    {
        const statsBySlotAndPayout = await calculateSlotPayoutStats(races);
        const recommendations = statsBySlotAndPayout
            .filter((x) => x.wins > 1)
            .filter((x) => x.profit.indexOf("-") === -1)
            .sort((a, b) => a.slot - b.slot || a.payout - b.payout);
        console.log("stats by slot and payout");
        console.table(statsBySlotAndPayout);
        console.log();
        console.log("recommendations");
        console.table(recommendations);
        {
            console.log(`
 * Bet profitable from recommendations`);
            clearBets(races);
            await generateBetsStrategyY(races, recommendations);
            const profit = await calculateProfit(races);
            console.log("profit", profit);
        }
    }
    console.log();
    {
        const statsBySlot = await calculateSlotStats(races);
        const recommendations = statsBySlot
            .filter((x) => x.wins > 1)
            .filter((x) => x.profit.indexOf("-") === -1)
            .sort((a, b) => a.slot - b.slot);
        console.log("stats by slot");
        console.table(statsBySlot);
        console.log();
        console.log("recommendations");
        console.table(recommendations);
        {
            console.log(`
 * Bet profitable from recommendations`);
            clearBets(races);
            await generateBetsStrategyZ(races, recommendations);
            const profit = await calculateProfit(races);
            console.log("profit", profit);
        }
    }

    console.groupEnd();
    console.log();
}

/**
 * Parse lines from input data into race objects with betting information.
 *
 * This function processes tab-separated values and extracts:
 * - Venue, time, round numbers
 * - Win indicators (binary values) for each slot
 * - Payout multipliers for each slot
 * - Calculates winning slot based on win indicators
 *
 * @param lines - Array of text lines from the input file
 * @returns Promise resolving to array of Race objects with parsed data
 */
async function parseLines(lines: string[]): Promise<Race[]> {
    let day = 1;
    let time: RaceTime = "12pm";
    let venue = "";
    let raceNumber = 1;
    const races: Race[] = [];

    const noResults: { day: number; time: RaceTime }[] = [];

    // loop through each line
    for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split("\t");
        // New format has 16 columns:
        // 0: Venue, 1: Time, 2: Round, 3-8: Results, 9: Gap, 10-15: Payouts
        if (parts.length >= 16) {
            const fileVenue = parts[0]!.trim();
            const fileTime = parts[1]!.trim();
            const fileRound = parts[2]!.trim();

            if (fileVenue) venue = fileVenue;
            if (fileTime) {
                const normalizedTime: RaceTime = fileTime === "12:00" ? "12pm" : fileTime === "18:00" ? "6pm" : (fileTime as RaceTime);
                if (time === "6pm" && normalizedTime === "12pm") {
                    day++;
                }
                time = normalizedTime;
            }
            if (fileRound) {
                raceNumber = parseInt(fileRound);
            }

            const payouts = parts.slice(10, 16).map(Number);
            const winningIndex = parts
                .slice(3, 9)
                .map(Number)
                .findIndex((n) => n === 1);

            if (winningIndex === -1) {
                console.log(`no results for venue=${venue} day=${day} time=${time} round=${raceNumber}, payouts=${payouts}`);
                noResults.push({ day, time });
            } else {
                const winningPayout = payouts[winningIndex]!;

                races.push({
                    day,
                    venue,
                    time,
                    raceNumber,
                    payouts,
                    bets: [],
                    winningSlot: <1 | 2 | 3 | 4 | 5 | 6>(winningIndex + 1),
                    winningPayout,
                });
            }
        }
    }
    return stripNoResultDays({ races, noResults });
}

function stripNoResultDays({ races, noResults }: { races: Race[]; noResults: { day: number; time: RaceTime }[] }) {
    // remove all races where the day is in the noResults array
    return races.filter((r) => !noResults.some((nr) => nr.day === r.day));
}

function clearBets(races: Race[]) {
    races.forEach((r) => {
        r.bets = [];
    });
}

/**
 * Bet slot 2 and 5 for 12pm and 6pm
 * @param races
 */
/**
 * Bet slot 2 and 5 for 12pm and 6pm
 * Strategy A: Conservative approach focusing on two slots that historically perform well
 * @param races
 */
async function generateBetsStrategyA(races: Race[]) {
    races.forEach((r, i, a) => {
        if (r.time === "12pm") {
            // always bet slot 2 and 5 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 5,
                cost: 200,
            });
        } else if (r.time === "6pm") {
            // always bet slot 2 and 5 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 5,
                cost: 200,
            });
        }
    });
}

/**
 * Bet slot 2 and 4 for 12pm and 6pm
 * @param races
 */
/**
 * Bet slot 2 and 4 for 12pm and 6pm
 * Strategy B: Alternative conservative approach with different slots
 * @param races
 */
async function generateBetsStrategyB(races: Race[]) {
    races.forEach((r, i, a) => {
        if (r.time === "12pm") {
            // always bet slot 2 and 4 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 4,
                cost: 200,
            });
        } else if (r.time === "6pm") {
            // always bet slot 2 and 4 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 4,
                cost: 200,
            });
        }
    });
}

/**
 * Bet slot 2, 4 and 5 for 12pm and 6pm
 * @param races
 */
/**
 * Bet slot 2, 4 and 5 for 12pm and 6pm
 * Strategy C: Balanced approach with three slots
 * @param races
 */
async function generateBetsStrategyC(races: Race[]) {
    races.forEach((r, i, a) => {
        if (r.time === "12pm") {
            // always bet slot 2, 4 and 5 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 4,
                cost: 200,
            });
            r.bets.push({
                slot: 5,
                cost: 200,
            });
        } else if (r.time === "6pm") {
            // always bet slot 2, 4 and 5 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 4,
                cost: 200,
            });
            r.bets.push({
                slot: 5,
                cost: 200,
            });
        }
    });
}

/**
 * Bet slot 2 for 12pm and 6pm
 * @param races
 */
/**
 * Bet slot 2 for 12pm and 6pm
 * Strategy D: Simple approach focusing on a single slot
 * @param races
 */
async function generateBetsStrategyD(races: Race[]) {
    races.forEach((r, i, a) => {
        if (r.time === "12pm") {
            // always bet slot 2 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
        } else if (r.time === "6pm") {
            // always bet slot 2 for 12pm
            r.bets.push({
                slot: 2,
                cost: 200,
            });
        }
    });
}

/**
 * Bet slot 4,5,6 for 12pm and 6pm
 * @param races
 */
/**
 * Bet slot 4,5,6 for 12pm and 6pm
 * Strategy E: Focus on bottom slots
 * @param races
 */
async function generateBetsStrategyE(races: Race[]) {
    races.forEach((r, i, a) => {
        if (r.time === "12pm") {
            // always bet slot 4,5,6 for 12pm
            r.bets.push({
                slot: 4,
                cost: 200,
            });
            r.bets.push({
                slot: 5,
                cost: 200,
            });
            r.bets.push({
                slot: 6,
                cost: 200,
            });
        } else if (r.time === "6pm") {
            // always bet slot 4,5,6 for 12pm
            r.bets.push({
                slot: 4,
                cost: 200,
            });
            r.bets.push({
                slot: 5,
                cost: 200,
            });
            r.bets.push({
                slot: 6,
                cost: 200,
            });
        }
    });
}
/**
 * Bet round 1 for 2nd and 3rd round
 * @param races
 */
async function generateBetsStrategyF(races: Race[]) {
    races.forEach((r, i, a) => {
        const firstRound = a[i - r.raceNumber + 1]!;
        if (r.raceNumber === 2 || r.raceNumber === 3) {
            r.bets.push({
                slot: firstRound.winningSlot,
                cost: 200,
            });
        }
    });
}
/**
 * Bet round 1 for 2nd and 3rd round
 * Bet round 2 for 3rd round
 * @param races
 */
async function generateBetsStrategyG(races: Race[]) {
    races.forEach((r, i, a) => {
        const firstRound = a[i - r.raceNumber + 1]!;
        const secondRound = a[i - r.raceNumber + 2]!;
        if (r.raceNumber === 2) {
            r.bets.push({
                slot: firstRound.winningSlot,
                cost: 200,
            });
        } else if (r.raceNumber === 3) {
            r.bets.push({
                slot: firstRound.winningSlot,
                cost: 200,
            });
            r.bets.push({
                slot: secondRound.winningSlot,
                cost: 200,
            });
        }
    });
}
/**
 * Bet profitable from recommendations
 * Up to 4 bets per race
 * @param races
 */
/**
 * Bet profitable from recommendations
 * Up to 4 bets per race
 * Strategy Y: Uses historical performance recommendations to place bets
 * @param races
 */
async function generateBetsStrategyY(races: Race[], recommendations: { slot: number; payout: number }[]) {
    races.forEach((r, i, a) => {
        recommendations.forEach((rec) => {
            if (r.payouts[rec.slot - 1] === rec.payout) {
                if (r.bets.length < 4) {
                    r.bets.push({ slot: rec.slot, cost: 200 });
                }
            }
        });
    });
}

/**
 * Bet profitable from recommendations
 * @param races
 */
/**
 * Bet profitable from recommendations
 * Strategy Z: Simple approach betting on recommended slots
 * @param races
 */
async function generateBetsStrategyZ(races: Race[], recommendations: { slot: number }[]) {
    races.forEach((r, i, a) => {
        recommendations.forEach((rec) => {
            r.bets.push({ slot: rec.slot, cost: 200 });
        });
    });
}

async function calculateProfit(races: Race[]): Promise<ProfitResults> {
    const results = {
        cost: 0,
        earning: 0,
        profit: 0,
        profitablity: 0,
        winningRate: 0,
        totalWins: 0,
        totalBets: 0,
        totalRaces: 0,
    };

    for (const r of races) {
        const cost = r.bets.map((b) => b.cost).reduce((acc, cost) => acc + cost, 0);
        results.cost += cost;

        const winningBet = r.bets.find((b) => b.slot === r.winningSlot);
        if (winningBet) {
            results.earning += r.winningPayout * winningBet.cost;
            results.profit += r.winningPayout * winningBet.cost - cost;
        } else {
            results.profit += -cost;
        }

        results.profitablity = (results.earning / results.cost) * 100;
        results.totalWins += r.bets.filter((b) => b.slot === r.winningSlot).length;
        results.totalBets += r.bets.length;
        results.totalRaces += 1;
        results.winningRate = results.totalWins / results.totalRaces;
    }
    return results;
}

/**
 * Calculate payout statistics for each slot and payout combination.
 * This provides insights into which combinations of slots and payouts
 * have been most profitable in the past, helping to identify good betting opportunities.
 *
 * @param races - Array of race data to analyze
 * @returns Promise resolving to sorted array of payout statistics with metrics like profit and win rate
 */
async function calculateSlotPayoutStats(races: Race[]) {
    const occurrencesBySlotAndPayout: Record<number, Record<number, number>> = {};

    for (const r of races) {
        for (let i = 0; i < 6; i++) {
            const slot = i + 1;
            const payout = r.payouts[i]!;
            if (!occurrencesBySlotAndPayout[slot]) occurrencesBySlotAndPayout[slot] = {};
            occurrencesBySlotAndPayout[slot][payout] = (occurrencesBySlotAndPayout[slot][payout] || 0) + 1;
        }
    }

    const winsBySlotAndPayout = races.reduce(
        (acc, r) => {
            const slot = r.winningSlot;
            const payout = r.winningPayout;
            if (!acc[slot]) {
                acc[slot] = {};
            }
            if (!acc[slot][payout]) {
                acc[slot][payout] = {
                    occurrences: 0,
                    wins: 0,
                    profit: 0,
                    winRate: 0,
                    totalPayout: 0,
                    expectedValue: 0,
                };
            }

            const occurrences = occurrencesBySlotAndPayout[slot]?.[payout] || 1;
            acc[slot][payout].occurrences = occurrences;

            acc[slot][payout].wins++;

            acc[slot][payout].winRate = (acc[slot][payout].wins / occurrences) * 100;
            acc[slot][payout].totalPayout += r.winningPayout;
            acc[slot][payout].profit = acc[slot][payout].totalPayout - acc[slot][payout].wins;

            const winCount = acc[slot][payout].wins;
            const pWin = winCount / occurrences;
            const pLose = 1 - pWin;
            acc[slot][payout].profit = winCount * payout - occurrences * 1;
            acc[slot][payout].expectedValue = pWin * payout - pLose * 1;

            return acc;
        },
        {} as {
            [slot: number]: {
                [payout: number]: {
                    occurrences: number;
                    wins: number;
                    profit: number;
                    winRate: number;
                    totalPayout: number;
                    expectedValue: number;
                };
            };
        },
    );

    const flattenedStats = Object.entries(winsBySlotAndPayout).flatMap(([slot, payouts]) =>
        Object.entries(payouts).map(([payout, stats]) => ({
            slot: Number(slot),
            payout: Number(payout),
            ...stats,
        })),
    );

    const sortedWinsBySlotAndPayout = flattenedStats.sort((a, b) => b.profit - a.profit);

    return sortedWinsBySlotAndPayout.map((x) => ({
        ...x,
        profit: x.profit + "x",
        winRate: (x.winRate.toFixed(2) + " %").padStart(7, " "),
        totalPayout: x.totalPayout + "x",
        expectedValue: x.expectedValue.toFixed(2),
    }));
}

/**
 * Calculate slot stats
 * @param races
 */
/**
 * Calculate slot statistics including win rates, profit and expected values.
 * This provides a comprehensive view of each slot's historical performance
 * across all races to inform betting decisions.
 *
 * @param races - Array of race data to analyze
 * @returns Promise resolving to sorted array of slot statistics with metrics like profit and win rate
 */
async function calculateSlotStats(races: Race[]) {
    const winsBySlot: {
        [slot: number]: {
            wins: number;
            profit: number;
            winRate: number;
            payout: number;
            expectedValue: number;
        };
    } = {};

    for (const r of races) {
        for (let slot = 1; slot < 7; slot++) {
            if (!winsBySlot[slot]) {
                winsBySlot[slot] = {
                    wins: 0,
                    profit: 0,
                    winRate: 0,
                    payout: 0,
                    expectedValue: 0,
                };
            }
            const obj = winsBySlot[slot]!;
            if (slot === r.winningSlot) {
                obj.wins++;
                obj.profit += r.winningPayout;
                obj.payout += r.winningPayout;
            }
            obj.profit -= 1;

            obj.winRate = (obj.wins / races.length) * 100;
        }
    }

    // 2nd pass
    for (const r of races) {
        for (let slot = 1; slot < 7; slot++) {
            const obj = winsBySlot[slot]!;

            const pWin = obj.wins / races.length;
            const pLose = 1 - pWin;

            obj.expectedValue += pWin * r.payouts[slot - 1]! - pLose * 1;
        }
    }

    // 3rd pass normalise expected value
    for (let slot = 1; slot < 7; slot++) {
        const obj = winsBySlot[slot]!;
        obj.expectedValue /= races.length;
    }

    const flattenedStats = Object.entries(winsBySlot).map(([slot, stats]) => ({
        slot: Number(slot),
        ...stats,
    }));

    const sortedWinsBySlot = flattenedStats.sort((a, b) => b.profit - a.profit);

    return sortedWinsBySlot.map((x) => ({ ...x, profit: x.profit + "x", winRate: (x.winRate.toFixed(2) + " %").padStart(7, " "), payout: x.payout + "x", expectedValue: x.expectedValue.toFixed(2) }));
}

/**
 * Main entry point for running betting strategies on race data.
 * Processes input files and executes multiple betting strategy comparisons to
 * evaluate performance and identify optimal approaches for different conditions.
 */
(async function () {
    await main();
})();
