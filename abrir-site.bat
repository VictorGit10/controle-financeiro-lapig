@echo off
cd /d "%~dp0frontend"
echo Servindo Controle Financeiro em http://localhost:8080
echo.
echo Pressione Ctrl+C para parar o servidor.
echo.
start http://localhost:8080
python -m http.server 8080