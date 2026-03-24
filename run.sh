#!/bin/sh
clear
bun src/cli/evaluate-strategies.ts data_current.txt | lolcat-rs
