@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Forgia - gerando instalador

echo ============================================
echo   Forgia - gerar instalador (Setup .exe)
echo ============================================
echo.

where node >nul 2>&1 || (echo [ERRO] Node.js nao encontrado no PATH. Instale em https://nodejs.org & goto :falha)
for /f "delims=" %%v in ('node -v') do echo Node %%v

set "SETUP=%~dp0release\Forgia-Setup.exe"
set "BACKUP=%TEMP%\forgia-package.json.bak"
copy /y package.json "%BACKUP%" >nul || (echo [ERRO] Nao consegui copiar o package.json. & goto :falha)

echo.
echo [1/4] Subindo a versao (patch)...
set "VERSAO="
for /f "delims=" %%v in ('node scripts\bump-version.mjs') do set "VERSAO=%%v"
if not defined VERSAO (echo [ERRO] Nao foi possivel subir a versao no package.json. & goto :falha)
echo Versao desta build: %VERSAO%

rem Cada build numa pasta nova: release\win-unpacked de uma build antiga pode estar travado
rem (Forgia aberto dali, ou outro programa que leu o app.asar) e o empacotamento falharia.
set "SAIDA=release\builds\%VERSAO%"
if exist "%SAIDA%" set "SAIDA=release\builds\%VERSAO%-%RANDOM%"

echo.
echo [2/4] Instalando dependencias...
call npm install --no-audit --no-fund || goto :falha

echo.
echo [3/4] Limpando builds antigas (as travadas ficam para a proxima vez)...
if exist "release\builds" for /d %%d in ("release\builds\*") do rd /s /q "%%d" 2>nul
if exist "%SETUP%" del /q "%SETUP%" 2>nul
if exist "%SETUP%" (echo [ERRO] release\Forgia-Setup.exe esta em uso. Feche o instalador e tente de novo. & goto :falha)

echo.
echo [4/4] Build do app + empacotamento do instalador em %SAIDA%...
call npx vite build || goto :falha
call npx electron-builder --win nsis --x64 -c.directories.output=%SAIDA% || goto :falha
if not exist "%SAIDA%\Forgia-Setup.exe" (echo [ERRO] O build terminou mas o instalador nao apareceu em %SAIDA%\ & goto :falha)
copy /y "%SAIDA%\Forgia-Setup.exe" "%SETUP%" >nul || (echo [ERRO] Nao consegui copiar o instalador para release\ & goto :falha)

del /q "%BACKUP%" 2>nul
echo.
echo ============================================
echo   PRONTO - Forgia %VERSAO%
echo ============================================
echo %SETUP%
for %%A in ("%SETUP%") do echo Gerado em %%~tA, %%~zA bytes.
echo.
explorer /select,"%SETUP%"
pause
exit /b 0

:falha
rem a versao so fica subida se o instalador saiu
if exist "%BACKUP%" (copy /y "%BACKUP%" package.json >nul & del /q "%BACKUP%" & echo Versao do package.json restaurada.)
echo.
echo *** FALHOU - veja a mensagem acima ***
pause
exit /b 1
