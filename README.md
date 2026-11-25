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

## Import logic

- Валидируются обязательные колонки таблицы.
- Строки без клиента в `users` пропускаются.
- Если заказ с таким `Номер накладной` уже есть, он обновляется.
- Если нет - создается новый заказ.
- При ошибках отправляется alert в Telegram (если настроен).
- При успешной выгрузке (created + updated > 0) отправляется alert в Telegram.

## Production deploy (Timeweb Cloud)

Сервер работает в Timeweb Cloud (App Platform): `https://mavludin-eleven-cargo-server-8f6b.twc1.net`.

1. Сборка и запуск:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`
2. Сервер слушает `PORT` (по умолчанию `4000`) на `0.0.0.0` - порт в настройках приложения Timeweb должен совпадать.
3. Переменные окружения задаются в панели Timeweb, список - в `.env.example`:
   - Firebase credentials и `ADMIN_UIDS`
   - Google Sheet settings
   - Telegram alert settings; `ALERT_TELEGRAM_API_URL` - адрес relay, если `api.telegram.org` с хостинга недоступен
   - `CORS_ORIGIN` с доменом админки (без завершающего `/`)
4. Для прода включи cron:
   - `CRON_ENABLED=true`
5. Для ручного запуска импорта (`POST /jobs/import-orders/run`) задай `JOB_TOKEN`.
6. Внешний монитор (UptimeRobot) проверяет `/status`; `/health` - только что процесс жив.

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
