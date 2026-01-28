# MSR Off-Road

A TypeScript-based backtesting and prediction engine for slot racing analysis.

## Features

- **Hidden Markov Model (HMM) Prediction**: Uses sequence learning to predict race outcomes
- **Statistical Analysis**: Multi-dimensional win rate calculations by slot, payout bucket, venue, and round
- **Backtesting Framework**: Walk-forward optimization with configurable strategies
- **Parallel Processing**: Worker-based architecture for efficient HMM training

## Installation

```bash
bun install
```

## Usage

### Basic Analysis

Run the main analysis script on your race data file:

```bash
bun run main.ts path/to/your/data.txt
```

### Backtesting

Run backtests with different configurations:

```bash
bun run backtest
```

### Benchmarking

Memory and performance benchmarking:

```bash
bun run benchmark
```

## Configuration

The project uses a modular configuration system with predefined strategies:

- **HIGHEST YIELD**: Maximizes total net profit (up to 3 bets per race)
- **EFFICIENCY**: Maximizes ROI with selective betting (1 bet per race)

Configure these in `config.ts`:

```typescript
// Example configuration
export const CONFIG = {
    ensembleSize: 120,
    trainingIterations: 600,
    hmmStates: 8,
    hmmObservations: 18,
    betLimit: 3,
    scoreWeights: {
        historical: 0.14224,
        hmm: 0.74676,
        momentum: 0.111,
    },
    minScoreThreshold: 0.1,
    relativeThreshold: 0.22,
};
```

## Data Format

The analysis expects tab-delimited data with the following columns:

- Venue name
- Race time (12pm or 6pm)
- Round number
- Results for slots 1-6
- Payout multipliers for slots 1-6

Example line:

```
VenueName	12:00	1	0	0	0	0	0	1	0	2.5	3.0	4.0	5.0	6.0	7.0
```

## Architecture

- **main.ts**: Entry point for analysis and strategy testing
- **backtest.ts**: Walk-forward optimization framework
- **prediction-engine.ts**: Core HMM-based prediction logic
- **hmm.ts**: Hidden Markov Model implementation
- **config.ts**: Strategy configurations
- **types.ts**: Type definitions and interfaces

## Development

### Formatting

```bash
bun run format      # Format code with Prettier
bun run format:check  # Check formatting without modifying files
```

### Type Checking

The project uses TypeScript with Bun's native type checking:

```bash
bun run --type-check
```

## License

This project is for educational and research purposes only. No gambling or real-money applications are intended.

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
