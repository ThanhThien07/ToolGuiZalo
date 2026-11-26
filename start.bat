@echo off
title ToolGuiZalo Pro V2 - Web Server Terminal
cd /d "%~dp0"

echo ================================================================
echo         TOOL GUI ZALO PRO V2 - KHOI DONG HE THONG
echo ================================================================
echo.

set "NODE_CMD="
if exist "%~dp0node.exe" (
    set "NODE_CMD=%~dp0node.exe"
    echo [*] Phat hien Node.js Portable san co ngay tai thu muc tool.
) else (
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        set "NODE_CMD=node"
        echo [*] Su dung Node.js he thong.
    )
)

if "%NODE_CMD%"=="" (
    echo [LOI]: Khong tim thay node.exe hoac Node.js tren may!
    pause
    exit /b 1
)

if not exist "%~dp0node_modules\" (
    echo [*] Dang cai dat thu vien node_modules...
    call npm install --omit=dev
    if %errorlevel% neq 0 (
        echo [LOI]: Cai dat thu vien that bai.
        pause
        exit /b 1
    )
)

rem Bao ve du lieu nguoi dung:
rem - Neu chay trong thu muc co san DB (workspace) thi dung truc tiep ./data
rem - Neu chay tu ban cai dat (C:\ToolGuiZalo) thi luu du lieu ben ngoai tai %LOCALAPPDATA%\ToolGuiZalo
rem   de cap nhat/cai lai ToolGuiZalo_Setup.exe KHONG BAO GIO mat du lieu.
if not defined DATA_DIR (
    if exist "%~dp0data\toolguizalo.db" (
        set "DATA_DIR=%~dp0data"
    ) else if exist "%~dp0data\database.json" (
        set "DATA_DIR=%~dp0data"
    ) else if exist "%~dp0.git\" (
        set "DATA_DIR=%~dp0data"
    ) else (
        set "DATA_DIR=%LOCALAPPDATA%\ToolGuiZalo\data"
        set "DB_PATH=%LOCALAPPDATA%\ToolGuiZalo\data\toolguizalo.db"
        set "BACKUP_DIR=%LOCALAPPDATA%\ToolGuiZalo\backups"
        set "UPLOADS_DIR=%LOCALAPPDATA%\ToolGuiZalo\uploads"
        set "USER_DATA_DIR=%LOCALAPPDATA%\ToolGuiZalo\user_data"
    )
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo [*] Thu muc du lieu: %DATA_DIR%
echo [*] Dang khoi chay Web Server tai: http://127.0.0.1:3000
echo [*] Trinh duyet se tu dong mo khi server san sang...
echo.
echo [Luu y]: Giu nguyen cua so Terminal nay trong suot luc su dung tool.
echo ================================================================
echo.

"%NODE_CMD%" "%~dp0server.js"
if %errorlevel% neq 0 (
    echo.
    echo [LOI]: Server da dung lai.
    pause
)
