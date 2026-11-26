# Orders Import Backend

Сервис читает данные из Google Sheet и импортирует в Firestore по расписанию.

## Setup

1. Создай файл `.env` на основе `.env.example`.
2. Установи зависимости:

```bash
npm install
```

3. Запуск в dev-режиме:

```bash
npm run dev
```

4. Запуск в prod-режиме:

```bash
npm run build
npm run start
```

## Endpoints

- `GET /` - базовый health endpoint
- `GET /health` - healthcheck
- `GET /status` - состояние импорта для внешнего монитора: 200 или 503 с `problem` (`import_failed`, `import_stale`)
- `POST /admin/errors` - отчёт об ошибке из админки (Bearer ID-токен админа) → лог и Telegram
- `POST /jobs/import-orders/run` - ручной запуск импорта  
  Если задан `JOB_TOKEN`, передавай header `x-job-token`.
- `POST /jobs/cny-rate/run` - ручное обновление курса юаня (тот же `x-job-token`)

## CNY rate

- Раз в час с 9 до 21 (`CRON_TZ`) сервер читает публичную ленту канала по `CNY_RATE_SOURCE_URL` и берёт самый свежий пост с датой и курсом «от 1 000 ¥». В prod это Cloudflare Worker, который проксирует `https://t.me/s/elvnpay`: `t.me` с хостинга недоступен.
- Курс пишется в Firestore `config/cnyRate` (`rate` - ₽ за 1 ¥, `rateDate`, `postUrl`, `updatedAt`), только если изменился и не старше сохранённого.
- Если с 16:00 курса за сегодня нет или лента не разбирается, уходит один alert в Telegram за день.
- Без `CNY_RATE_SOURCE_URL` или при `CRON_ENABLED=false` обновление по расписанию выключено.

## Import logic

- Валидируются обязательные колонки таблицы.
- Строки без клиента в `users` пропускаются.
- Если заказ с таким `Номер накладной` уже есть, он обновляется.
- Если нет - создается новый заказ.
- При ошибках отправляется alert в Telegram (если настроен).
- При успешной выгрузке (created + updated > 0) отправляется alert в Telegram.

## Production deploy (Railway)

1. В сервисе Railway укажи:
   - **Root Directory**: `.` (для отдельного backend-репозитория)
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`
   - Если backend лежит в монорепозитории, укажи папку проекта как Root Directory.
2. Не задавай `PORT` вручную. Railway сам передает порт.
3. Обязательно задай переменные из `.env.example`:
   - Firebase credentials
   - Google Sheet settings
   - Telegram alert settings
   - `CORS_ORIGIN` с доменом frontend (без завершающего `/`)
4. Для прода включи cron:
   - `CRON_ENABLED=true`
5. Для ручного запуска импорта через UI задай:
   - `JOB_TOKEN` в backend
   - такой же токен во frontend env (`VITE_IMPORT_API_TOKEN`)
6. Healthcheck в Railway:
   - путь `/health` (или `/`)

## Smoke test after deploy

Проверка доступности:

```bash
curl -i "https://<your-backend-domain>/health"
```

Ручной запуск:

```bash
curl -i -X POST "https://<your-backend-domain>/jobs/import-orders/run" \
  -H "x-job-token: <JOB_TOKEN>"
```
