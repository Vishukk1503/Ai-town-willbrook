@echo off
cd /d "%~dp0"
node scripts\start-willowbrook.mjs
if errorlevel 1 pause
