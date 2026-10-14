<div align="center">

# Список задач (DevOps Pet)

Список задач на Flask + PostgreSQL: даты и время, приоритеты, группировка по срокам, напоминания со звуком, светлая и тёмная темы.

Данные хранятся в БД и переживают перезапуск контейнеров (Docker volume).

[![CI](https://github.com/Alexkon22/-pet-project/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexkon22/-pet-project/actions/workflows/ci.yml) ![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white) ![Flask](https://img.shields.io/badge/Flask-3.0.3-000000?logo=flask&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

</div>

<!--
  SCREENSHOT PLACEHOLDER
  В репозитории нет изображений интерфейса — не подставляйте выдуманный скриншот.
  Когда файл появится, вставьте его сюда, например:
  ![Интерфейс списка задач](docs/screenshot.png)
-->

## Содержание

- [Стек](#stack)
- [Возможности](#features)
- [Быстрый старт](#quick-start)
- [Часовой пояс](#timezone)
- [Структура](#structure)
- [Проверка](#health)
- [CI](#ci)
- [Локально без Docker](#local)

<h2 id="stack">🧱 Стек</h2>

| Технология | Версия | Роль |
| --- | --- | --- |
| Python | 3.11 | Язык (`python:3.11-slim`, CI) |
| Flask | 3.0.3 | Веб-приложение |
| psycopg2-binary | 2.9.9 | Драйвер PostgreSQL |
| PostgreSQL | 16 | База данных (`postgres:16-alpine`) |
| Docker Compose | — | Сборка и запуск контейнеров |
| pytest | 8.3.3 | Тесты |
| Ruff | 0.6.9 | Линтер |

<h2 id="features">✨ Возможности</h2>

| Возможность | Описание |
| --- | --- |
| Задачи | Отметить выполненной, вернуть в работу, отредактировать, удалить |
| Приоритеты | Средняя, важная и очень важная — с цветовым кодированием |
| Группировка | Просрочено, сегодня, завтра, на этой неделе, позже, без срока |
| Разделы | Мой день, важно, запланировано, все задачи, выполнено |
| Напоминания | Звук и системные уведомления браузера |
| Виджет | Плавающие часы и календарь, позиция запоминается |
| Тема | Переключатель светлой и тёмной темы |

<h2 id="quick-start">🚀 Быстрый старт</h2>

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

<h2 id="timezone">🕐 Часовой пояс</h2>

Контейнеры по умолчанию живут в UTC, из-за чего «сегодня» и «просрочено» считаются неверно. Пояс задаётся переменной `TZ` (по умолчанию `Europe/Moscow`):

```bash
TZ=Europe/Berlin docker compose up -d
```

<h2 id="structure">📁 Структура</h2>

```text
.
├── app.py                      Flask: роуты, работа с БД, группировка задач
├── templates/
│   ├── index.html              Разметка страницы
│   └── _fields.html            Общие поля формы (создание и редактирование)
├── static/
│   ├── css/style.css           Дизайн-токены, светлая и тёмная темы
│   └── js/app.js               Фильтры, календарь, темы, напоминания
├── tests/
│   └── test_app.py             Тесты /health и создания задачи
├── .github/workflows/ci.yml    GitHub Actions: ruff, pytest, docker build
├── Dockerfile
├── docker-compose.yml
├── requirements.txt            Flask, psycopg2-binary
├── requirements-dev.txt        pytest, ruff
├── pytest.ini
├── ruff.toml
└── .env.example
```

<h2 id="health">✅ Проверка</h2>

- UI: http://localhost:5000
- Health: http://localhost:5000/health

<h2 id="ci">🔁 CI</h2>

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

<h2 id="local">💻 Локально без Docker</h2>

<details>
<summary>Показать команды</summary>

Нужен запущенный Postgres и переменная `DATABASE_URL`.

```bash
pip install -r requirements.txt
set DATABASE_URL=postgresql://todo:todo@localhost:5432/todo
python app.py
```

</details>
