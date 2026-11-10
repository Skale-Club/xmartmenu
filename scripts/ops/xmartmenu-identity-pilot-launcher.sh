#!/bin/sh
set -eu
test "$#" -eq 1
exec node /app/pilot/xmartmenu-identity-pilot-cli.mjs --serve-reviewed "$1" < /run/secrets/xmartmenu-identity-pilot-config
