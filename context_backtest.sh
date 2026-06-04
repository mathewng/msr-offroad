#!/bin/sh
# Context EV Predictor backtest (no HMM)
bun src/backtest/backtest-context.ts data_historical.txt data_current.txt
echo
echo "--- Conservative (1 bet, relative edge) ---"
bun src/backtest/backtest-context.ts data_historical.txt data_current.txt --conservative
