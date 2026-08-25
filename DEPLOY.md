# Свой сервер Stargaze

Самый простой путь — локальный запуск (`npm run serve` или `docker run`
из README). Этот гайд — про VPS с HTTPS и basic auth, чтобы небо было
доступно с любого устройства.

Состав: контейнер `stargaze` (веб + API) и контейнер `caddy`
(HTTPS Let's Encrypt, basic auth, Origin-гейт для POST).

## Шаги

1. DNS: A-запись домена на IP сервера.
2. На сервер, в один каталог: `deploy/docker-compose.yml` и
   `deploy/Caddyfile.example` (переименовать в `Caddyfile`).
3. bcrypt-хеш пароля:
   `docker run --rm caddy:2.10 caddy hash-password --plaintext 'твой-пароль'`
4. Рядом создать `caddy.env`:

   ```
   STARGAZE_DOMAIN=stargaze.example.com
   STARGAZE_ACME_EMAIL=you@example.com
   STARGAZE_BASIC_USER=you
   STARGAZE_PASSWORD_HASH=<хеш из шага 3 как есть, $ не экранировать>
   ```

5. Открыть порты: `ufw allow 80,443/tcp`
6. Запуск: `docker compose --env-file caddy.env up -d`
7. Проверка: `https://<домен>` → basic auth → небо.

## Обновление

```bash
docker compose pull && docker compose --env-file caddy.env up -d
```

Перед обновлением загляни в [CHANGELOG](CHANGELOG.md).

## Бэкап

Все данные — один файл в томе `stargaze-data`:

```bash
docker run --rm -v stargaze-data:/data alpine cat /data/store.json > backup-$(date +%F).json
```

## CLI и агенты на сервере

```bash
docker exec stargaze node cli.js status
docker exec stargaze node cli.js propose-quest --title "…" --type short --xp 40 --note "зачем"
```

Агенту достаточно уметь выполнять эти команды (или POST `/api/action`
изнутри сети сервера).
