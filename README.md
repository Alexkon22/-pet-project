# Список задач (DevOps Pet)

[![CI](https://github.com/Alexkon22/-pet-project/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexkon22/-pet-project/actions/workflows/ci.yml)

Список задач на Flask + PostgreSQL: даты и время, приоритеты, группировка по срокам,
напоминания со звуком, светлая и тёмная темы.
Данные хранятся в БД и переживают перезапуск контейнеров (Docker volume).

## Стек

- Flask (веб-приложение)
- PostgreSQL 16
- Docker + Docker Compose

## Структура

```
app.py                  Flask: роуты, работа с БД, группировка задач
templates/index.html    Разметка страницы
templates/_fields.html  Общие поля формы (создание и редактирование)
static/css/style.css    Дизайн-токены, светлая и тёмная темы
static/js/app.js        Фильтры, календарь, темы, напоминания
```

## Запуск

```bash
docker compose up --build -d
```

Открой в браузере: http://localhost:5000

Остановить:

```bash
docker compose down
```

Данные останутся в volume `postgres_data`. Чтобы удалить и данные тоже:

```bash
docker compose down -v
```

## Часовой пояс

Контейнеры по умолчанию живут в UTC, из-за чего «сегодня» и «просрочено»
считаются неверно. Пояс задаётся переменной `TZ` (по умолчанию `Europe/Moscow`):

```bash
TZ=Europe/Berlin docker compose up -d
```

## Возможности

- Отметить задачу выполненной, вернуть в работу, отредактировать, удалить
- Приоритеты (средняя / важная / очень важная) с цветовым кодированием
- Автоматическая группировка: просрочено, сегодня, завтра, на этой неделе, позже, без срока
- Разделы: мой день, важно, запланировано, все задачи, выполнено
- Напоминания со звуком и системными уведомлениями браузера
- Плавающий виджет часов и календаря (позиция запоминается)
- Переключатель светлой и тёмной темы

## Проверка

- UI: http://localhost:5000
- Health: http://localhost:5000/health

## CI

На каждый push и pull request в `main` GitHub Actions запускает:

- `ruff check` — линтер
- `pytest` — тесты `/health` и создание задачи (Postgres в CI)
- `docker build` — сборка образа

Локально:

```bash
pip install -r requirements.txt -r requirements-dev.txt
pytest
ruff check .
```

## Локально без Docker (опционально)

Нужен запущенный Postgres и переменная `DATABASE_URL`.

```bash
pip install -r requirements.txt
set DATABASE_URL=postgresql://todo:todo@localhost:5432/todo
python app.py
```

## Что дальше

- gunicorn вместо dev-сервера Flask
- Secrets вместо пароля в compose
- Kubernetes (позже)
