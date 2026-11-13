@echo off
chcp 65001 >nul
echo =========================================================
echo   Khoi dong ToolGuiZalo Web App tai http://localhost:3000
echo =========================================================
start http://localhost:3000
node server.js
pause

