#!/bin/sh
clear
bun main.ts data_historical.txt | lolcat-rs
bun main.ts data_current.txt | lolcat-rs
