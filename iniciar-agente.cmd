@echo off
REM Sobe o agente via pm2 no login do Windows (restaura o processo salvo com "pm2 save").
REM Para usar: copie este arquivo para a pasta de Inicializacao do Windows
REM (Win+R, digite shell:startup e Enter).
call "%APPDATA%\npm\pm2.cmd" resurrect
