#!/bin/sh
# CLI Stargaze на сервере: исполняется в контейнере stargaze.
exec docker exec stargaze node /data/bin/cli.js "$@"
