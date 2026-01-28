#!/bin/sh
# clear
bun backtest.ts --print-config-only --yield
# bun backtest.ts data_nonexistent.txt data_current.txt --yield | lolcat-rs
bun backtest.ts data_historical.txt data_current.txt --yield | lolcat-rs
# bun backtest.ts data_current.txt data_current.txt --yield | lolcat-rs
# bun backtest.ts data_both.txt data_current.txt --yield | lolcat-rs
echo
echo
echo
bun backtest.ts --print-config-only --eff
# bun backtest.ts data_nonexistent.txt data_current.txt --eff | lolcat-rs
bun backtest.ts data_historical.txt data_current.txt --eff | lolcat-rs
# bun backtest.ts data_current.txt data_current.txt --eff | lolcat-rs
# bun backtest.ts data_both.txt data_current.txt --eff | lolcat-rs

# bun backtest.ts --print-config-only --yield
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

# bun backtest.ts --print-config-only --eff
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
