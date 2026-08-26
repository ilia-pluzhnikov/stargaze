#!/bin/sh
# CLI Stargaze на сервере: исполняется в контейнере stargaze.
#
# Это артефакт установки сопровождающего: деплой кладёт его в
# /usr/local/bin/stargaze и рассчитывает на раскладку, где cli.js лежит
# в каталоге данных, смонтированном внутрь контейнера как /data.
#
# В публичном примере deploy/docker-compose.yml такой раскладки нет: там
# /data — том только под store.json, а CLI живёт в самом образе. Вызов для
# стека из примера — напрямую, без этого шима:
#   docker exec stargaze node /app/cli.js status
exec docker exec stargaze node /data/bin/cli.js "$@"
