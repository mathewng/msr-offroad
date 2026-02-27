# AGENTS.md

## Toolchain

- **Runtime**: Bun
- **Language**: TypeScript 5.x
- **Formatter**: Prettier

## Directory Layout

- No src directory present; all source files are in root.
- Key modules: `backtest.ts`, `config.ts`, `hmm.ts`, `hmm-worker.ts`, `prediction-engine.ts`, `worker-pool.ts`, `random-pool.ts`, `optimizer.ts`, `analyze_data.ts`, `utils.ts`, `types.ts`

## Build, Lint, and Test Commands

### Build Commands

- `bun run backtest` - Run backtesting functionality

### Lint and Format Commands

- `bun run format` - Format all files using Prettier
- `bun run format:check` - Check formatting without modifying files

### Other Commands

- `bun run benchmark` - Run memory benchmark (memory-benchmark.ts)
- `./backtest.sh` - Run backtests with multiple strategies (yield, bet2, eff)

### Test Commands

- **Note**: This codebase does not appear to have explicit test files or test runner configuration
- For running a single test file, use: `bun run <test-file>.ts` if tests exist

## Code Style Guidelines

### Imports

- Use ES module syntax with `import`/`export`
- Import types using `import type { TypeName } from './module'`
- Organize imports in order: external modules, internal modules, types

### Formatting

- Follow Prettier formatting rules as defined in package.json
- Use 2-space indentation
- No trailing whitespace
- Consistent spacing around operators and in function signatures

### Types

- Prefer explicit typing over type inference where clarity improves
- Use TypeScript interfaces for object shapes
- Use union types for limited value sets (e.g., `type RaceTime = "12:00" | "18:00" | "12pm" | "6pm";`)
- Use explicit casting when necessary (e.g., `<1 | 2 | 3 | 4 | 5 | 6>(winningIndex + 1)`)

### Naming Conventions

- PascalCase for interfaces and types
- camelCase for functions, variables, and properties
- Constants in UPPER_CASE
- Use descriptive names that clearly indicate purpose

### Error Handling

- Use try/catch blocks for async operations
- Log errors to console with meaningful context
- Handle edge cases gracefully (e.g., empty data files)
- Return early from functions when appropriate

### Best Practices

- Keep functions small and focused on single responsibilities
- Use descriptive comments for complex logic
- Structure code with clear separation of concerns
- Use `async/await` for asynchronous operations
- Avoid magic numbers in favor of named constants
- Use strict TypeScript compilation options

## Data files for backtesting

- `data_historical.txt` - Historical race data
- `data_current.txt` - Current season data

## Bun-Specific Notes

- Use `bun` instead of `node` to run scripts and manage dependencies
- You may want to add Bun-specific commands for running tests if you integrate a test framework later
