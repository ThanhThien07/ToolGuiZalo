@echo off
rem ================================================================
rem ToolGuiZalo Pro - Script dong goi 1 file .exe duy nhat
rem ================================================================
cd /d "%~dp0"

echo ================================================================
echo       DANG DONG GOI TOOLGUIZALO THANH 1 FILE .EXE DUY NHAT
echo ================================================================
echo.

if not exist "dist" mkdir "dist"

"C:\Program Files\WinRAR\Rar.exe" a -sfx -s -r -z"sfx_config.txt" -x"user_data\*" -x".agents\*" -x"graphify-out\*" -x"bin\*" -x".git\*" -x"dist\*" -x"*.zip" -x"*.rar" "dist\ToolGuiZalo_Installer.exe" node.exe server.js start.bat package.json data public src uploads node_modules

if exist "dist\ToolGuiZalo_Installer.exe" (
    copy /y "dist\ToolGuiZalo_Installer.exe" "ToolGuiZalo_Setup.exe" >nul
    echo.
    echo ================================================================
    echo [THANH CONG]: Da tao xong file: ToolGuiZalo_Setup.exe - Dung luong ~31MB
    echo Ban chi can gui duy nhat file ToolGuiZalo_Setup.exe sang may khac la xong!
    echo ================================================================
) else (
    echo.
    echo [LOI]: Dong goi that bai.
)

pause
