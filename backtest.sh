#!/bin/sh
# clear
bun src/backtest/backtest.ts data_historical.txt data_current.txt --print-config-only --yield
for a in `seq 1 10`
do bun src/backtest/backtest.ts data_historical.txt data_current.txt --yield | tail -n14 | lolcat-rs
done
bun src/backtest/backtest.ts data_historical.txt data_current.txt --yield | lolcat-rs
echo
echo
echo
bun src/backtest/backtest.ts data_historical.txt data_current.txt --print-config-only --bet2
for a in `seq 1 10`
do bun src/backtest/backtest.ts data_historical.txt data_current.txt --bet2 | tail -n14 | lolcat-rs
done
bun src/backtest/backtest.ts data_historical.txt data_current.txt --bet2 | lolcat-rs
echo
echo
echo
#bun src/backtest/backtest.ts data_historical.txt data_current.txt --print-config-only --eff
#for a in `seq 1 10`
#do bun src/backtest/backtest.ts data_historical.txt data_current.txt --eff --historical-weight=0 --hmm-weight=1 | tail -n14 | lolcat-rs
#done
#bun src/backtest/backtest.ts data_historical.txt data_current.txt --eff | lolcat-rs
