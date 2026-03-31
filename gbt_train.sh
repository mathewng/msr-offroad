#!/bin/sh
# Train on all available seen data from both historical and current files
bun src/cli/train-gbt.ts data_historical.txt data_current.txt
