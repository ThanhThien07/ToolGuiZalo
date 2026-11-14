@echo off
rem ================================================================
rem ToolGuiZalo Pro - Portable Launcher
rem ================================================================

cd /d "%~dp0"

echo ================================================================
echo           TOOL GUI ZALO PRO - KHOI DONG HE THONG
echo ================================================================
echo.

set "NODE_CMD="

rem 1. Kiem tra node.exe ngay tai thu muc goc hoac thu muc bin
if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    echo [*] Phat hien Node.js Portable san co ngay tai thu muc tool.
) else if exist "%~dp0bin\node.exe" (
    set "NODE_CMD=%~dp0bin\node.exe"
    echo [*] Phat hien Node.js Portable san co trong thu muc bin.
) else (
    rem 2. Neu khong co thi kiem tra node tren he thong
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        set "NODE_CMD=node"
        echo [*] Su dung Node.js da cai tren he thong.
    )
)

if "%NODE_CMD%"=="" (
    echo [LOI]: May tinh nay chua cai dat Node.js va thieu file node.exe!
    echo.
    echo Vui long:
    echo 1. Khong xoa file node.exe di kem trong thu muc tool nay.
    echo HOAC
    echo 2. Cai dat Node.js ban LTS tu trang: https://nodejs.org
    echo.
    echo Dang mo trang web tai Node.js...
    start https://nodejs.org
    pause
    exit /b 1
)

rem 3. Kiem tra thu muc node_modules
if not exist "%~dp0node_modules\" (
    echo [THONG BAO]: Thieu thu muc thu vien node_modules.
    echo Dang tu dong cai dat thu vien, vui long cho giay lat...
    call npm install
    if %errorlevel% neq 0 (
        echo [LOI]: Cai dat thu vien that bai. Vui long kiem tra ket noi mang.
        pause
        exit /b 1
    )
)

rem 4. Chay server
echo [*] Dang khoi chay Web Server tai: http://localhost:3000
echo [*] Trinh duyet se tu dong mo ngay khi server san sang...
echo.
echo [Luu y]: Hay giu nguyen cua so nay trong suot luc su dung tool.
echo ================================================================
echo.

"%NODE_CMD%" "%~dp0server.js"
if %errorlevel% neq 0 (
    echo.
    echo [LOI]: Server da dung lai do co su co o tren.
    echo.
    pause
)
pause
