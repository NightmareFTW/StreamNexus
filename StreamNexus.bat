@echo off
setlocal
title StreamNexus
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Instala-o em https://nodejs.org e volta a abrir este ficheiro.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo A instalar as dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo Falhou a instalacao das dependencias.
    pause
    exit /b 1
  )
)

echo A iniciar o StreamNexus...
call npm run desktop
if errorlevel 1 pause
