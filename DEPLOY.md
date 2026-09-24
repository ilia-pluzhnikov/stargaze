# Свой сервер Stargaze

Самый простой путь — локальный запуск (`npm run serve` или `docker run`
из README). Этот гайд — про VPS с HTTPS и basic auth, чтобы небо было
доступно с любого устройства.

Состав: контейнер `stargaze` (веб + API) и контейнер `caddy`
(HTTPS Let's Encrypt, basic auth, Origin-гейт для POST). Caddy здесь
пример — чем заменить, см. [«Прокси»](#прокси-почему-caddy-и-чем-заменить).

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

## Вход без пароля: телевизор и другие устройства

Браузер телевизора забывает basic auth при каждом перезапуске, а набирать
пароль с пульта тяжело. Для таких устройств есть ссылка устройства: один раз
открыть `https://<домен>/?device=<токен>`. Caddy поставит cookie на год
(`__Host-`, `Secure`, `HttpOnly`) и уведёт на чистый адрес. Дальше это
устройство входит без пароля, остальным по-прежнему нужен basic auth.
Проверено на LG webOS 22: cookie переживает выключение ТВ.

1. Токен: `openssl rand -hex 32`.
2. В `caddy.env` добавить строку `STARGAZE_DEVICE_TOKEN=<токен>`. У caddy в
   `docker-compose.yml` переменная уже есть в примере; в compose, собранном
   раньше, добавь её в `environment:` сам.
3. `docker compose --env-file caddy.env up -d`
4. Открыть ссылку на устройстве один раз.

Без переменной или с токеном короче 32 символов вход по ссылке выключен,
работает только basic auth.

Ссылка равносильна паролю: не пересылай её в чаты и заметки. В истории
браузера устройства она останется, но там же лежит и сама cookie. В лог
Caddy токен не попадает. Чтобы отозвать доступ у всех устройств, смени
токен и перезапусти caddy. Через год cookie истечёт — открой ссылку снова.

## Прокси: почему Caddy и чем заменить

Stargaze о прокси не знает: контейнер слушает `8643`, авторизации у
API нет, Origin-гейт внутри Stargaze работает только при локальном
`serve` на loopback. Всё, что защищает небо снаружи, делает прокси.

Caddy в примере — потому что HTTPS, пароль, Origin-гейт и вход устройства
умещаются в 60 строк. Аккаунт не нужен: образ `caddy:2.10` с Docker Hub,
сертификат Let's Encrypt Caddy получает сам; `STARGAZE_ACME_EMAIL` —
только адрес для писем об истечении сертификата.

Любая замена — nginx, Traefik, Cloudflare Tunnel с Access, уже стоящий
на сервере Caddy — обязана делать три вещи:

1. HTTPS.
2. Авторизация — basic auth или любая другая.
3. `POST /api/action` пропускать только с `Origin: https://<домен>`.
   Basic auth сам по себе от CSRF не защищает: браузер приложит
   сохранённый пароль и к cross-site POST с чужого сайта.

Upstream — `stargaze:8643` в docker-сети compose-примера или
`127.0.0.1:8643` при host-network. Агент ходит мимо прокси (`docker
exec` или внутренняя сеть), поэтому прокси может резать всё чужое, не
оглядываясь на него. Готовый site-блок для своего Caddy —
`deploy/Caddyfile.example`.

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
