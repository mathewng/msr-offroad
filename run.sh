#!/bin/sh
clear
bun src/main.ts data_historical.txt | lolcat-rs
bun src/main.ts data_current.txt | lolcat-rs
