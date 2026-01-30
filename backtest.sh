#!/bin/sh
# clear
bun backtest.ts data_historical.txt data_current.txt --print-config-only --yield
#bun backtest.ts data_nonexistent.txt data_current.txt --yield | lolcat-rs
bun backtest.ts data_historical.txt data_current.txt --yield | lolcat-rs
echo
echo
echo
bun backtest.ts data_historical.txt data_current.txt --print-config-only --eff
# bun backtest.ts data_nonexistent.txt data_current.txt --eff | lolcat-rs
bun backtest.ts data_historical.txt data_current.txt --eff | lolcat-rs

# bun backtest.ts data_historical.txt data_current.txt --print-config-only --yield
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --yield | grep -E "ROI|Converged"

# bun backtest.ts data_historical.txt data_current.txt --print-config-only --eff
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
# bun backtest.ts data_historical.txt data_current.txt --eff | grep -E "ROI|Converged"
