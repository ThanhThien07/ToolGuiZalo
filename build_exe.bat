@echo off
rem ================================================================
rem ToolGuiZalo Pro - Script dong goi 1 file duy nhat
rem ================================================================
cd /d "%~dp0"

echo ================================================================
echo       DANG DONG GOI TOOLGUIZALO THANH 1 FILE DUY NHAT
echo ================================================================
echo.

if not exist "dist" mkdir "dist"
if exist "CHAY_TOOL_NGAY.bat" del /f /q "CHAY_TOOL_NGAY.bat"
if exist "ToolGuiZalo_Portable.rar" del /f /q "ToolGuiZalo_Portable.rar"
if exist "ToolGuiZalo_Portable.zip" del /f /q "ToolGuiZalo_Portable.zip"
if exist "ToolGuiZalo_Setup.exe" del /f /q "ToolGuiZalo_Setup.exe"
if exist "dist\ToolGuiZalo_Installer.exe" del /f /q "dist\ToolGuiZalo_Installer.exe"

rem 1. Tao 1 file .exe duy nhat (tu bung ngam va chay luon, khong lo code)
"C:\Program Files\WinRAR\Rar.exe" a -sfx -s -r -z"sfx_config.txt" -x"user_data\*" -x".agents\*" -x"graphify-out\*" -x"bin\*" -x".git\*" -x"dist\*" -x"*.zip" -x"*.rar" -x"ToolGuiZalo*.exe" "dist\ToolGuiZalo_Installer.exe" node.exe server.js start.bat package.json data public src uploads node_modules

if exist "dist\ToolGuiZalo_Installer.exe" (
    copy /y "dist\ToolGuiZalo_Installer.exe" "ToolGuiZalo_Setup.exe" >nul

    rem 2. Boc DUY NHAT 1 file ToolGuiZalo_Setup.exe vao .rar de gui qua Zalo (khong chua file code nao ben trong .rar)
    "C:\Program Files\WinRAR\Rar.exe" a -m0 -ep "ToolGuiZalo_Portable.rar" "ToolGuiZalo_Setup.exe" >nul

    echo.
    echo ================================================================
    echo [THANH CONG]:
    echo   1. ToolGuiZalo_Setup.exe    - 1 file .exe duy nhat, bam la chay!
    echo   2. ToolGuiZalo_Portable.rar - Ben trong CHI CO DUY NHAT 1 file ToolGuiZalo_Setup.exe - Dung de gui qua Zalo
    echo ================================================================
) else (
    echo.
    echo [LOI]: Dong goi that bai.
)


