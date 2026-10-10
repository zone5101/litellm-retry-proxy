@echo off
title GitHub Login - silent retry checkpoint
"C:\Users\Z One\.gh-cli\bin\gh.exe" auth login -h github.com -p https -w --skip-ssh-key
echo.
echo ============================================================
echo Neu thay "Logged in as zone5101" la THANH CONG.
echo Bao Daedalus tieng "xong" de tao repo va push.
echo ============================================================
pause