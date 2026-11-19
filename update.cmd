@echo off
rem Double-click to pull fresh prices, print today's summary and push to GitHub Pages.
cd /d "%~dp0"
git pull -q --rebase
python scripts\update.py --push
pause
