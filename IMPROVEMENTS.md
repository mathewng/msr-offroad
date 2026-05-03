# HMM Modeling Roadmap: Beyond Discrete Chunking

This document outlines the transition from heuristic-based "chunking" to mathematically rigorous HMM-native temporal adaptation strategies.

## 1. The "Chunk Size" Limitation
Currently, the system uses a `chunkSize` (default: 9) to trigger batch retraining. While effective (achieving peak ROI at 9), this is a "meta-parameter" external to the HMM itself, leading to jerky adaptation and "lag" in regime detection.

## 2. Venue-Aware Regime Modeling (New Discovery)

Empirical analysis confirms that venues change every 3–6 races, and each venue has distinct win-rate biases (e.g., Slot 5 in Cactus Desert has ~2.0 EV). The "magic" chunk size of 9 is likely a heuristic approximation of these 3–6 race venue windows.

### A. Venue-Boundary Resets
Instead of a fixed `chunkSize`, trigger HMM retraining or memory flushing exactly when the `venue` changes.
* **Benefit**: Aligns the model's "refresh" cycle with the actual game mechanics, preventing cross-contamination between different courses.

### B. Venue-Specific Priors
Use the historical performance of a venue as the Bayesian Prior for the HMM's emission matrix.
* **Implementation**: When entering a venue, initialize the HMM's $\mathbf{B}$ matrix using the normalized historical win rates for that specific location.
* **Benefit**: Allows the model to start with a "warm" understanding of the venue's favorites while using HMM to detect real-time deviations or "streaks" within that session.

### C. Round-Number Dynamics
Round 3 in a session exhibits a significant shift in win probability: Slot 1/2 win rates jump from ~23% to ~30%, while Slot 6 effectively collapses (from ~9% to ~3%). This interaction is often venue-dependent (e.g., strongest in Ludibrium and Deep Sea World).
* **Concept**: Intra-session "fatigue" or course-learning bias.
* **Benefit**: Treating Round 3 as a specific sub-regime allows for much more aggressive betting on front-runners in the session finale.

## 3. Venue x Round number Interaction
The "Round 3 Bias" is not universal—it is venue-dependent:

Ludibrium: Massive significance. Slot 1/2 win rate jumps from 17% (R1) to 35% (R3).
Deep Sea World: Significant jump from 24% (R1) to 31% (R3).
Aqua Road: Counter-trend. Actually slightly declines or stays flat for Slots 1/2 in Round 3.
Minar Forest: Jumps from 13% (R1) to 22% (R2/R3).

The round number is a powerful secondary feature. It shouldn't just be used for "chunking" boundaries.

Actionable Insights: The HMM should ideally be "Round-Aware," perhaps by using a different transition matrix for Round 3 or including the round number in the observation space.

## 4. Implementation Priorities

1.  **[ ] Implement Venue x Round Priors in HMM**: Update the HMM prediction engine (`src/core/hmm.ts`) to initialize its emission matrix (or provide a Bayesian prior) based on the specific Venue *and* Round number combo (leveraging `StatsResult.venueRoundMap`).
2.  **[ ] Venue/Round Aware Backtesting**: Modify the backtester (`src/backtest/backtest.ts`) to extract current venue and round number for each prediction and pass it to the prediction engine. Add flags like `--use-venue-round-priors` to test this approach against the baseline.
3.  **[ ] Transition to MAP Adaptation**: Modify `src/core/hmm.ts` to accept `seedParams` as a Bayesian prior rather than just a starting point for random perturbation, allowing the venue x round prior to stabilize the model.
4.  **[ ] Venue-Boundary Resets**: Implement and test resetting the HMM state or flushing the observation window exactly when the venue changes (e.g., `--reset-on-venue`), abandoning the fixed 9-race chunking heuristic.
5.  **[ ] Online Update Prototype**: Create a lightweight version of the prediction engine that updates a single "master" HMM online after every race, rather than retraining from scratch on sliding windows.
