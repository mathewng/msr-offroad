# Context EV Predictor — Validation

Detailed numbers and methodology live in **[ROADMAP.md § Engine validation](ROADMAP.md#engine-validation)**.

## Quick commands

```bash
bun run backtest:context
./context_backtest.sh
bun src/backtest/backtest-context.ts --file data_all.txt
bun run predict
```

Pending races in `data_current.txt` are scored but excluded from ROI until resolved.
