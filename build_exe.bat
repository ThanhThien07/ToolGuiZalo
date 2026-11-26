@echo off
rem ================================================================
rem ToolGuiZalo Pro V2 - Script dong goi Sach (Khong dong goi data/secrets/profile)
rem Uu tien Inno Setup neu co; neu khong se tao SFX sach ben ngoai Program Files.
rem ================================================================
cd /d "%~dp0"

echo ================================================================
echo       DANG DONG GOI TOOLGUIZALO PRO V2 (CLEAN BUILD)
echo ================================================================
echo.

if not exist "dist" mkdir "dist"
if exist "dist\ToolGuiZalo_V2_Setup.exe" del /f /q "dist\ToolGuiZalo_V2_Setup.exe"

if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    echo [*] Phat hien Inno Setup 6 - dang bien dich bo cai dat chuan...
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "installer\ToolGuiZalo.iss"
) else (
    echo [!] Khong tim thay Inno Setup 6. Dang tao goi portable sach khong kem data/user_data/secrets...
    if exist "C:\Program Files\WinRAR\Rar.exe" (
        "C:\Program Files\WinRAR\Rar.exe" a -sfx -s -r -z"sfx_config.txt" -x"data\*" -x"user_data\*" -x"uploads\*" -x".agents\*" -x"graphify-out\*" -x"bin\*" -x".git\*" -x"dist\*" -x"*.zip" -x"*.rar" -x"ToolGuiZalo*.exe" -x".env" "dist\ToolGuiZalo_V2_Setup.exe" node.exe server.js start.bat package.json .env.example src public scripts node_modules
    )
)

echo.
echo [HOAN TAT] Kiem tra thu muc dist\
