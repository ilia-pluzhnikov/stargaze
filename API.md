# HTTP API Stargaze

Справочник для агента-гейм-мастера и интеграций. API отдаёт тот же сервер,
что и веб: `stargaze serve` или контейнер из образа, порт 8643.

Своей авторизации у API нет. Снаружи — только через прокси с HTTPS и паролем
([DEPLOY.md](DEPLOY.md)). Агент на том же сервере ходит мимо прокси: из
docker-сети compose-примера — `http://stargaze:8643`, при host-network —
`http://127.0.0.1:8643`.

```bash
curl -s http://stargaze:8643/api/status
curl -s 'http://stargaze:8643/api/quests?filter=today'
curl -s -X POST http://stargaze:8643/api/action \
  -H 'content-type: application/json' \
  -d '{"type":"completeQuest","questId":"q_walk","day":"2026-10-30","ts":"2026-10-30T05:00:00.000Z"}'
```

## Общее

- Тела запросов и ответов — JSON в UTF-8; ответы без отступов.
- Отказ — `{ "error": "текст" }`, иногда с уточняющими полями (ниже по
  маршрутам). Тексты по-русски.
- «Сегодня» — игровой день в поясе UTC+7, сервер считает его в момент
  запроса. Поле `day` в действиях — тоже игровой день, `YYYY-MM-DD`; `ts` —
  ISO-момент.
- Id в путях и параметрах GET — точный или уникальный префикс (как в git):
  `/api/quests/q_run` найдёт `q_run5k`, если других `q_run…` нет. Точный id
  выигрывает у длинных id с тем же началом.

## Чтение

| Маршрут | Что отдаёт |
|---|---|
| `GET /api/health` | `{"ok":true}` — сервер жив; store не читает |
| `GET /api/store` | store целиком, формат v4 (старый файл мигрируется при чтении, на диске не меняется) |
| `GET /api/status` | сводка дня: персонаж, «на сегодня», навыки, кошелёк |
| `GET /api/wallet` | кошелёк искр: баланс, капание, квота переносов, эмиссия, журнал |
| `GET /api/quests` | список квестов; `?filter=active\|today\|proposed\|all` |
| `GET /api/quests/<id>` | карточка квеста; у эпика — дети и прогресс |
| `GET /api/skills` | живые навыки: уровень и ранги |
| `GET /api/ranks?skill=<id>` | лестница рангов навыка |
| `GET /api/stars` | звёзды; `?skill=<id>`, `?tier=D\|C\|B\|A\|S` |
| `GET /api/stats` | XP по неделям; `?weeks=1..52` (по умолчанию 4) |
| `GET /api/wishlist` | витрина наград без архива |

Срезы `/api/status` … `/api/wishlist` — ровно тот JSON, что печатает
`cli.js <команда> --json` на том же store: обе головы зовут одно ядро
(`src/logic/views.ts`). Параметры query повторяют флаги команды без `--`:
`/api/stars?skill=sk_health&tier=C` ≡ `cli.js stars --skill sk_health --tier C --json`.
Пустой параметр — как отсутствующий. Чтение store не меняет.

Коды ответов срезов:

| Код | Когда | Тело |
|---|---|---|
| 200 | срез построен | JSON среза |
| 400 | кривой параметр: неизвестный `filter`, нет `skill` у `/api/ranks`, `tier` вне D\|C\|B\|A\|S, `weeks` вне 1..52 | `{ error }`; тексты общие с CLI и называют флаг: `--tier: D\|C\|B\|A\|S` |
| 404 | нет квеста под id или навыка под `skill` | `{ error }` |
| 409 | префикс неоднозначен | `{ error, matches: [id, …] }` — уточни id одним из кандидатов |
| 503 | store не инициализирован | `{ error }` |
| 500 | store не читается (битый файл) | `{ error }` |

### `GET /api/status`

```json
{
  "character": { "name": "Странник", "level": 2, "into": 140, "toNext": 450, "totalXp": 440 },
  "today": { "due": 4, "habitsDone": 1 },
  "skills": [
    { "id": "sk_health", "name": "Здоровье", "level": 1, "into": 30, "toNext": 100,
      "ranksTotal": 5, "ranksAchieved": 1, "currentRank": "C" }
  ],
  "sparks": { "balance": -55, "provision": 100, "moves": { "used": 1, "free": 3 } }
}
```

- `character.into / toNext` — XP внутри уровня и цена уровня; `totalXp` —
  всего, не меньше нуля.
- `today.due` — активные контракты, положенные на сегодня (срок сегодня или
  прошёл; short без срока); `today.habitsDone` — привычки, отмеченные сегодня.
- `skills` — без архивных; `currentRank` — первый невзятый ранг, `null` —
  взято всё или у навыка нет звёзд.
- `sparks.balance` — Σ ledger минус капание просрочек, бывает отрицательным;
  `moves.used` — переносов дедлайна за 7 дней, `free` — бесплатных в окне.

### `GET /api/wallet`

```json
{
  "balance": -55, "ledgerTotal": 45, "provisionTotal": 100,
  "provisions": [{ "questId": "q_late", "title": "Просрочка", "provision": 100, "cap": 100 }],
  "moves": { "used": 1, "free": 3 },
  "emission": { "d7": 10, "d30": 30 },
  "ledger": [
    { "id": "l7", "ts": "2026-10-30T02:00:00.000Z", "day": "2026-10-30", "kind": "earn", "amount": 10, "questId": "q_walk" },
    { "id": "l1", "ts": "2026-10-01T05:00:00.000Z", "day": "2026-10-01", "kind": "adjust", "amount": 50, "note": "старт" }
  ]
}
```

- `provisions` — активные просроченные контракты: сколько уже накапало
  (`provision`) и потолок (`cap`, он же награда).
- `emission` — заработано за 7 и 30 игровых дней, откаты вычтены.
- `ledger` — журнал целиком, последнее записанное — первым. `kind`: `earn`,
  `drain`, `moveFee`, `cancelFee`, `spend`, `adjust`, `reversal`.

### `GET /api/quests`

Массив квестов как в store, в порядке store (поля — `Quest` в
`src/types.ts`). Выборки, как флаги `cli.js quests`:

- без `filter` или `filter=active` — все активные, привычки тоже;
- `today` — активные контракты на сегодня (как `today.due` в status);
- `proposed` — предложенные, ждут accept/reject;
- `all` — всё, кроме архива.

### `GET /api/quests/<id>`

Квест как в store, поиск по всем статусам, архив включая. У эпика (есть
неархивные подквесты) — ещё два поля:

```json
{
  "id": "q_epic", "title": "Эпик", "type": "mid", "skillId": "sk_learn", "xpReward": 200,
  "dueDate": "2026-11-20", "status": "active", "createdAt": "2026-10-01T01:00:00.000Z",
  "children": ["q_epic_1", "q_epic_2", "q_epic_3"],
  "progress": { "done": 1, "total": 2 }
}
```

`children` — id подквестов по `createdAt`, proposed включая; `progress` —
по active и done, `null`, если дети только proposed.

### `GET /api/skills`

```json
[{ "id": "sk_health", "name": "💪 Здоровье", "level": 1, "into": 0, "toNext": 100, "ranks": { "total": 5, "achieved": 1 } }]
```

Без архивных; `name` — с эмодзи.

### `GET /api/ranks?skill=<id>`

```json
[
  { "tier": "D", "achieved": true, "lit": 2, "total": 2 },
  { "tier": "C", "achieved": false, "lit": 1, "total": 3 }
]
```

Только ранги, в которых есть звёзды, от D к S. Ранг взят, когда зажжено
не меньше 60% его звёзд. Архивный навык тоже находится.

### `GET /api/stars`

Массив звёзд как в store (`StarComponent` в `src/types.ts`): `litAt` —
когда зажжена, `parentStarId` — откуда растёт.

### `GET /api/stats?weeks=N`

```json
[
  { "weekStart": "2026-10-19", "total": 20, "bySkill": { "sk_health": 20, "null": 0 } },
  { "weekStart": "2026-10-26", "total": 20, "bySkill": { "sk_health": 10, "null": 10 } }
]
```

Недели Пн–Вс от старой к текущей. Ключ `"null"` — XP квестов без навыка;
ноль после отката остаётся в объекте.

### `GET /api/wishlist`

Позиции витрины как в store (`WishlistItem`), без архива: `small` — с ценой
в искрах (`repeatable` — многоразовая), `big` — с якорем-звездой
(`claimedAt` — получена). Куплена ли разовая small, в позиции не хранится:
это `spend` с её `itemId` в `ledger` (`/api/wallet`) без парного `reversal`.

## Запись: `POST /api/action`

Тело — одно действие `{ "type": "…", …поля }`, то же, что применяет веб.
Ответ 200 — store целиком после действия, а заголовок `Stargaze-Applied`
говорит, изменилось ли что-то: `1` — действие записано, `0` — тихий no-op
(повтор уже применённого, квест не найден или не в том статусе). Перечитывать
store после записи не нужно.

Id сущности передаётся в поле по её типу — `questId`, `skillId`, `starId`,
`itemId`, а не `id`. Квест, навык, звезда и позиция витрины в add/update
передаются объектом целиком (поля — `src/types.ts`); лишние поля, например
вычисляемые `children` и `progress` из `cli.js quest --json`, отбрасываются.

| `type` | Поля | Заметки |
|---|---|---|
| `completeQuest` | `questId`, `day`, `ts`, `result?`, `force?` | short/mid/long требуют `result.summary` и закрытый DoD (или `force`); привычка — одна отметка в день, не наперёд, искры только за сегодня/вчера |
| `uncompleteQuest` | `questId`, `day`, `ts` | откат отметки или сдачи компенсирующими событиями |
| `proposeQuest` | `quest` | `quest.status: "proposed"`, `proposalNote` — зачем |
| `acceptQuest` | `questId`, `ts` | |
| `rejectQuest` | `questId` | |
| `addQuest` / `updateQuest` | `quest` | после принятия награда, тип и срок контракта заморожены |
| `archiveQuest` | `questId`, `day`, `ts` | отмена активного контракта списывает неустойку |
| `moveDueDate` | `questId`, `to`, `day`, `ts` | три бесплатных переноса за 7 дней, дальше платно |
| `addSkill` / `updateSkill` | `skill` | |
| `archiveSkill` | `skillId` | |
| `addStar` / `updateStar` | `star` | |
| `removeStar` / `unlightStar` | `starId` | |
| `lightStar` | `starId`, `ts`, `evidence?` | |
| `setCharacter` | `character: { name, avatar }` | |
| `addWishlistItem` / `updateWishlistItem` | `item` | |
| `archiveWishlistItem` | `itemId` | |
| `purchaseItem` | `itemId`, `day`, `ts`, `opId?` | `opId` гасит повтор той же операции |
| `spendSparks` | `amount`, `note`, `day`, `ts`, `opId?` | |
| `claimReward` | `itemId`, `ts` | big-награда за зажжённую звезду |
| `adjustSparks` | `amount`, `note`, `day`, `ts` | ручная корректировка с причиной, любой знак |
| `setGameTz` | `offsetMin` | игровой пояс мира в минутах от UTC: целое, кратное 15, −720…840; по умолчанию 420 (UTC+7) |
| `importStore` | `store` | заменяет состояние целиком |
| `resetToSeed` | — | демо-мир вместо текущего состояния |

Коды ответов:

| Код | Когда | Тело |
|---|---|---|
| 200 | действие применено (`Stargaze-Applied: 1`) или тихий no-op (`Stargaze-Applied: 0`): повтор уже применённого, тот же `opId`, квест не найден или не в том статусе | store |
| 400 | битый JSON, не объект, нет или неизвестный `type`, нет обязательного поля или не тот тип (`day` — `YYYY-MM-DD`, `amount` — число…); на `id` вместо `questId` — подсказка | `{ error }` |
| 403 | чужой `Origin` у локального `serve` на loopback; запросы без `Origin` проходят | `{ error }` |
| 413 | тело больше 1 МБ | `{ error }` |
| 422 | `completeQuest` контракта без непустого `result.summary` (и с `force` тоже) | `{ error }` |
| 422 | `completeQuest` с незакрытыми пунктами DoD без `force` | `{ error, dod: [текст пункта] }` |
| 422 | `completeQuest` эпика с активными подквестами без `force` | `{ error, children: [{ id, title }] }` |
| 422 | `completeQuest` привычки на день позже игрового дня `ts` (отметка наперёд) | `{ error }` |
| 422 | нехватка искр у `purchaseItem` / `spendSparks` | `{ error }` |
| 422 | `claimReward` до зажигания звезды-якоря | `{ error }` |
| 422 | `moveDueDate` в прошлое | `{ error }` |
| 422 | `archiveSkill` с активными контрактами | `{ error, contracts: [{ id, title }] }` |
| 422 | store после действия не прошёл валидацию; файл не тронут | `{ error, errors: [...] }` |
| 500 | внутренняя ошибка | `{ error }` |
