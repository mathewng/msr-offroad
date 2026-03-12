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
    profitability: number;
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
 * Bet slot 1, 2 and 3 for 12pm and 6pm`);
        clearBets(races);
        await generateBetsStrategyA(races);
        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Bet slot 4, 5 and 6 for 12pm and 6pm`);
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
 * Bet slot 1,2,3,4,5,6 @100 for 12pm and 6pm`);
        clearBets(races);
        await generateBetsStrategyD(races);
        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }

    {
        console.log(`
 * Venue based`);
        clearBets(races);
        await generateBetsStrategyH(races);

        const profit = await calculateProfit(races);
        console.log("profit", profit);
    }
    {
        console.log(`
 * Venue and round based`);
        clearBets(races);
        await generateBetsStrategyI(races);

        const profit = await calculateProfit(races);
        console.log("profit", profit);
        console.table(races);
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
 * Supports new format (tab-separated, optional header):
 * Date, Time, Venue, Round, Payout1..Payout6, Player1..Player6, Win1..Win6.
 * Win: "1" = slot won, blank = didn't win, "?" = no data.
 * Legacy: Venue, Time, Round, W1..W6, Gap, P1..P6.
 *
 * @param lines - Array of text lines from the input file
 * @returns Promise resolving to array of Race objects with parsed data (only races with a winner)
 */
async function parseLines(lines: string[]): Promise<Race[]> {
    let day = 1;
    let time: RaceTime = "12pm";
    let venue = "";
    let raceNumber = 1;
    const races: Race[] = [];

    for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split("\t");

        // Skip header row (new format)
        if (parts[0]?.trim() === "Date" && parts[2]?.trim() === "Venue") continue;

        // New format: Date, Time, Venue, Round, Payout1-6, Player1-6, Win1-6
        if (parts.length >= 22) {
            const fileVenue = parts[2]!.trim();
            const fileTime = parts[1]!.trim();
            const fileRound = parts[3]!.trim();
            if (fileVenue) venue = fileVenue;
            if (fileTime) {
                const normalizedTime: RaceTime = fileTime === "12:00" ? "12pm" : fileTime === "18:00" ? "6pm" : (fileTime as RaceTime);
                if (time === "6pm" && normalizedTime === "12pm") day++;
                time = normalizedTime;
            }
            if (fileRound) raceNumber = parseInt(fileRound, 10) || raceNumber;

            const payouts = parts.slice(4, 10).map((p) => (p?.trim() === "?" ? NaN : Number(p ?? 0)));
            const winCols = parts.slice(16, 22);
            const winningIndex = winCols.findIndex((w) => w?.trim() === "1");

            if (winningIndex === -1) {
                console.log(`no results for venue=${venue} day=${day} time=${time} round=${raceNumber}, payouts=${payouts}`);
            } else {
                const winningPayout = payouts[winningIndex];
                if (winningPayout != null && !isNaN(winningPayout)) {
                    races.push({
                        day,
                        venue,
                        time,
                        raceNumber,
                        payouts,
                        bets: [],
                        winningSlot: (winningIndex + 1) as 1 | 2 | 3 | 4 | 5 | 6,
                        winningPayout,
                    });
                }
            }
            continue;
        }

        // Legacy format: Venue, Time, Round, W1-W6, Gap, P1-P6
        if (parts.length >= 16) {
            const fileVenue = parts[0]!.trim();
            const fileTime = parts[1]!.trim();
            const fileRound = parts[2]!.trim();
            if (fileVenue) venue = fileVenue;
            if (fileTime) {
                const normalizedTime: RaceTime = fileTime === "12:00" ? "12pm" : fileTime === "18:00" ? "6pm" : (fileTime as RaceTime);
                if (time === "6pm" && normalizedTime === "12pm") day++;
                time = normalizedTime;
            }
            if (fileRound) raceNumber = parseInt(fileRound, 10) || raceNumber;

            const payouts = parts.slice(10, 16).map(Number);
            const winningIndex = parts
                .slice(3, 9)
                .map(Number)
                .findIndex((n) => n === 1);

            if (winningIndex === -1) {
                console.log(`no results for venue=${venue} day=${day} time=${time} round=${raceNumber}, payouts=${payouts}`);
            } else {
                const winningPayout = payouts[winningIndex]!;
                races.push({
                    day,
                    venue,
                    time,
                    raceNumber,
                    payouts,
                    bets: [],
                    winningSlot: (winningIndex + 1) as 1 | 2 | 3 | 4 | 5 | 6,
                    winningPayout,
                });
            }
        }
    }
    return races;
}

function clearBets(races: Race[]) {
    races.forEach((r) => {
        r.bets = [];
    });
}

/**
 * Bet slot 1, 2 and 3 for 12pm and 6pm
 * @param races
 */
async function generateBetsStrategyA(races: Race[]) {
    races.forEach((r, i, a) => {
        if (r.time === "12pm") {
            r.bets.push({
                slot: 1,
                cost: 200,
            });
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 3,
                cost: 200,
            });
        } else if (r.time === "6pm") {
            r.bets.push({
                slot: 1,
                cost: 200,
            });
            r.bets.push({
                slot: 2,
                cost: 200,
            });
            r.bets.push({
                slot: 3,
                cost: 200,
            });
        }
    });
}

/**
 * Bet slot 4, 5 and 6 for 12pm and 6pm
 * @param races
 */
async function generateBetsStrategyB(races: Race[]) {
    races.forEach((r, i, a) => {
        if (r.time === "12pm") {
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
 * Bet slot 1,2,3,4,5,6 @100 for 12pm and 6pm
 * @param races
 */
async function generateBetsStrategyD(races: Race[]) {
    races.forEach((r, i, a) => {

        const winningSlots: number[] = [];
        if (a[i - 1]?.winningSlot) winningSlots.push(a[i - 1]?.winningSlot);
        if (a[i - 2]?.winningSlot) winningSlots.push(a[i - 2]?.winningSlot);
        if (a[i - 3]?.winningSlot) winningSlots.push(a[i - 3]?.winningSlot);


        console.log(`winningSlots=${winningSlots.join(",")}`);
        winningSlots.sort((a, b) => a - b);
        if (winningSlots.length > 0) {
            let newWinningSlots = [...new Set(winningSlots)];
            if (newWinningSlots.length < winningSlots.length) {
                for (const slot of newWinningSlots) {
                    r.bets.push({ slot, cost: 200 });
                }
            } else {
                newWinningSlots.sort((a, b) => a - b);
                newWinningSlots.splice(0,1);
                for (const slot of newWinningSlots) {
                    r.bets.push({ slot, cost: 200 });
                }
            }
        };
        
        console.log(`bets=${r.bets.map(b=>b.slot).join(",")}`);
    });
}
/**
 * Venue-based strategy (no round/raceNumber).
 * Computes pWin and expected value per (venue, slot) from allRaces,
 * then for each race places 2 bets on the top 2 slots by expected value.
 * @param races
 */
async function generateBetsStrategyH(races: Race[]) {
    const data_historical = await Bun.file('data_historical.txt').text();
    const lines = data_historical.split("\n");
    const allRaces = [...(await parseLines(lines)), ...races];

    // Group by venue only; for each group compute per-slot wins, occurrences, totalPayout when slot wins
    type SlotStats = { wins: number; totalPayoutWhenWon: number };
    const groupKey = (r: Race) => r.venue ?? "?";
    const byVenue: Record<string, { occurrences: number; slots: Record<number, SlotStats> }> = {};

    for (const r of allRaces) {
        const key = groupKey(r);
        if (!byVenue[key]) {
            byVenue[key] = {
                occurrences: 0,
                slots: {} as Record<number, SlotStats>,
            };
            for (let s = 1; s <= 6; s++) {
                byVenue[key]!.slots[s] = { wins: 0, totalPayoutWhenWon: 0 };
            }
        }
        const group = byVenue[key]!;
        group.occurrences++;
        const slot = r.winningSlot;
        group.slots[slot]!.wins++;
        group.slots[slot]!.totalPayoutWhenWon += r.winningPayout;
    }

    // Compute pWin and expected value for each (venue, slot)
    type SlotEV = { pWin: number; expectedValue: number };
    const evByVenueSlot: Record<string, Record<number, SlotEV>> = {};
    for (const key of Object.keys(byVenue)) {
        const group = byVenue[key]!;
        evByVenueSlot[key] = {};
        for (let slot = 1; slot <= 6; slot++) {
            const slotStat = group.slots[slot]!;
            const { wins, totalPayoutWhenWon } = slotStat;
            const pWin = group.occurrences > 0 ? wins / group.occurrences : 0;
            const avgPayoutWhenWon = wins > 0 ? totalPayoutWhenWon / wins : 0;
            const pLose = 1 - pWin;
            const expectedValue = pWin * avgPayoutWhenWon - pLose * 1;
            evByVenueSlot[key][slot] = { pWin, expectedValue };
        }
    }

    // For each race, place 2 bets on the top 2 slots by expected value (by venue only)
    for (const r of races) {
        const key = groupKey(r);
        const slotEvs = evByVenueSlot[key];
        if (!slotEvs) {
            continue;
        }
        const slotsByEV = (Object.entries(slotEvs) as [string, SlotEV][])
            .map(([s, ev]) => ({ slot: Number(s), expectedValue: ev.expectedValue }))
            .sort((a, b) => b.expectedValue - a.expectedValue);
        const top2 = slotsByEV.slice(0, 2);
        for (const { slot } of top2) {
            r.bets.push({ slot, cost: 200 });
        }
    }

    // console.table(races);
}

/**
 * Venue and round based strategy.
 * Computes pWin and expected value per (venue, raceNumber, slot) from allRaces,
 * then for each race places 2 bets on the top 2 slots by expected value.
 * @param races
 */
async function generateBetsStrategyI(races: Race[]) {
    const data_historical = await Bun.file('data_historical.txt').text();
    const lines = data_historical.split("\n");
    const allRaces = [...await parseLines(lines), ...races];

    // Group by (venue, raceNumber); for each group compute per-slot wins, occurrences, totalPayout when slot wins
    type SlotStats = { wins: number; totalPayoutWhenWon: number };
    const groupKey = (r: Race) => `${r.venue ?? "?"}|${r.raceNumber}`;
    const byVenueRound: Record<string, { occurrences: number; slots: Record<number, SlotStats> }> = {};

    for (const r of allRaces) {
        const key = groupKey(r);
        if (!byVenueRound[key]) {
            byVenueRound[key] = {
                occurrences: 0,
                slots: {} as Record<number, SlotStats>,
            };
            for (let s = 1; s <= 6; s++) {
                byVenueRound[key]!.slots[s] = { wins: 0, totalPayoutWhenWon: 0 };
            }
        }
        const group = byVenueRound[key]!;
        group.occurrences++;
        const slot = r.winningSlot;
        group.slots[slot]!.wins++;
        group.slots[slot]!.totalPayoutWhenWon += r.winningPayout;
    }

    // Compute pWin and expected value for each (venue, raceNumber, slot)
    type SlotEV = { pWin: number; expectedValue: number };
    const evByVenueRoundSlot: Record<string, Record<number, SlotEV>> = {};
    for (const key of Object.keys(byVenueRound)) {
        const group = byVenueRound[key]!;
        evByVenueRoundSlot[key] = {};
        for (let slot = 1; slot <= 6; slot++) {
            const slotStat = group.slots[slot]!;
            const { wins, totalPayoutWhenWon } = slotStat;
            const pWin = group.occurrences > 0 ? wins / group.occurrences : 0;
            const avgPayoutWhenWon = wins > 0 ? totalPayoutWhenWon / wins : 0;
            const pLose = 1 - pWin;
            const expectedValue = pWin * avgPayoutWhenWon - pLose * 1;
            evByVenueRoundSlot[key][slot] = { pWin, expectedValue };
        }
    }


    // For each race, place 2 bets on the top 2 slots by expected value
    for (const r of races) {
        const key = groupKey(r);
        const slotEvs = evByVenueRoundSlot[key];
        if (!slotEvs) {
            continue;
        }
        const slotsByEV = (Object.entries(slotEvs) as [string, SlotEV][])
            .map(([s, ev]) => ({ slot: Number(s), expectedValue: ev.expectedValue }))
            .sort((a, b) => b.expectedValue - a.expectedValue);
        const top2 = slotsByEV.slice(0, 2);
        for (const { slot } of top2) {
            r.bets.push({ slot, cost: 200 });
        }
    }

    // console.table(races);
}

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
        profitability: 0,
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

        results.profitability = (results.earning / results.cost) * 100;
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
    }

    for (const r of races) {
        for (let slot = 1; slot < 7; slot++) {
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
