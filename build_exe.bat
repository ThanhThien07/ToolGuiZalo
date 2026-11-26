@echo off
rem ================================================================
rem ToolGuiZalo Pro V2 - Dong goi thanh 1 file duy nhat ToolGuiZalo_Setup.exe
rem Khong dong goi data/user_data/uploads/.env de khong lam mat du lieu may khac
rem ================================================================
cd /d "%~dp0"

echo ================================================================
echo     DONG GOI TOOLGUIZALO PRO V2 THANH 1 FILE DUY NHAT (.EXE)
echo ================================================================
echo.

if exist "dist" rmdir /s /q "dist"
if exist "ToolGuiZalo_Portable.rar" del /f /q "ToolGuiZalo_Portable.rar"
if exist "ToolGuiZalo_Portable.zip" del /f /q "ToolGuiZalo_Portable.zip"
if exist "ToolGuiZalo_Setup.exe" del /f /q "ToolGuiZalo_Setup.exe"

"C:\Program Files\WinRAR\Rar.exe" a -sfx -s -r -z"sfx_config.txt" ^
  -x"data\*" -x"user_data\*" -x"uploads\*" -x"tests\*" -x"docs\*" -x"installer\*" ^
  -x".agents\*" -x"graphify-out\*" -x".git\*" -x".github\*" -x"dist\*" ^
  -x"*.zip" -x"*.rar" -x"ToolGuiZalo*.exe" -x"ToolGuiZalo_Pro_V2_Roadmap.md" -x".env" ^
  "ToolGuiZalo_Setup.exe" ^
  node.exe server.js start.bat package.json package-lock.json .env.example README.md src public scripts node_modules

if exist "ToolGuiZalo_Setup.exe" (
    echo.
    echo ================================================================
    echo [THANH CONG]: Da tao 1 file duy nhat: ToolGuiZalo_Setup.exe
    echo - Tai ve bam dup la tu bung va tu dong mo Terminal + Web App!
    echo - Du lieu nguoi dung duoc bao toan tai %%LOCALAPPDATA%%\ToolGuiZalo
    echo ================================================================
) else (
    echo.
    echo [LOI]: Dong goi that bai!
    exit /b 1
)
