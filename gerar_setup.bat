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

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSAO=%%v
set "SETUP=%~dp0release\Forgia-Setup-%VERSAO%.exe"

echo.
echo [1/3] Instalando dependencias...
call npm install --no-audit --no-fund || goto :falha

echo.
echo [2/3] Removendo instalador anterior...
if exist "%SETUP%" del /q "%SETUP%"

echo.
echo [3/3] Build do app + empacotamento do instalador...
call npm run dist:win || goto :falha

if not exist "%SETUP%" (echo [ERRO] O build terminou mas o instalador nao apareceu em release\ & goto :falha)

echo.
echo ============================================
echo   PRONTO
echo ============================================
echo %SETUP%
for %%A in ("%SETUP%") do echo Gerado em %%~tA, %%~zA bytes.
echo.
explorer /select,"%SETUP%"
pause
exit /b 0

:falha
echo.
echo *** FALHOU - veja a mensagem acima ***
pause
exit /b 1
