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

## Endpoints

- `GET /health` - healthcheck
- `POST /jobs/import-orders/run` - ручной запуск импорта  
  Если задан `JOB_TOKEN`, передавай header `x-job-token`.

## Import logic

- Валидируются обязательные колонки таблицы.
- Строки без клиента в `users` пропускаются.
- Если заказ с таким `Номер накладной` уже есть, он обновляется.
- Если нет - создается новый заказ.
- При ошибках отправляется alert в Telegram (если настроен).
