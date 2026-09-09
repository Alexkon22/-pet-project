import os
import time
from datetime import date, datetime, timedelta
from datetime import time as dt_time

import psycopg2
from flask import Flask, jsonify, redirect, render_template, request
from psycopg2.extras import RealDictCursor

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://todo:todo@db:5432/todo",
)

PRIORITY_LABELS = {
    "medium": "Средняя",
    "important": "Важная",
    "critical": "Очень важная",
}

PRIORITY_RANK = {"critical": 0, "important": 1, "medium": 2}

REMIND_LABELS = {
    0: "в момент",
    5: "за 5 мин",
    15: "за 15 мин",
    30: "за 30 мин",
    60: "за 1 ч",
    1440: "за 1 день",
}

# Порядок групп в списке задач: сначала то, что горит, в конце — выполненное.
GROUP_ORDER = ["overdue", "today", "tomorrow", "week", "later", "nodate", "done"]

GROUP_LABELS = {
    "overdue": "Просрочено",
    "today": "Сегодня",
    "tomorrow": "Завтра",
    "week": "На этой неделе",
    "later": "Позже",
    "nodate": "Без срока",
    "done": "Выполнено",
}

GROUP_ICONS = {
    "overdue": "alert",
    "today": "sun",
    "tomorrow": "sunrise",
    "week": "calendar",
    "later": "clock",
    "nodate": "inbox",
    "done": "check",
}


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def init_db():
    for _ in range(30):
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS tasks (
                            id SERIAL PRIMARY KEY,
                            title TEXT NOT NULL,
                            due_date DATE,
                            due_time TIME,
                            remind BOOLEAN NOT NULL DEFAULT FALSE,
                            remind_minutes INTEGER NOT NULL DEFAULT 0,
                            priority TEXT NOT NULL DEFAULT 'medium',
                            done BOOLEAN NOT NULL DEFAULT FALSE,
                            done_at TIMESTAMPTZ,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                        )
                        """
                    )
                    cur.execute(
                        """
                        ALTER TABLE tasks
                        ADD COLUMN IF NOT EXISTS due_date DATE,
                        ADD COLUMN IF NOT EXISTS due_time TIME,
                        ADD COLUMN IF NOT EXISTS remind BOOLEAN NOT NULL DEFAULT FALSE,
                        ADD COLUMN IF NOT EXISTS remind_minutes INTEGER NOT NULL DEFAULT 0,
                        ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium',
                        ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT FALSE,
                        ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ
                        """
                    )
                conn.commit()
            return
        except psycopg2.OperationalError:
            time.sleep(1)
    raise RuntimeError("Could not connect to the database")


def _parse_date(value: str):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_time(value: str):
    if not value:
        return None
    try:
        parts = value.split(":")
        return dt_time(int(parts[0]), int(parts[1]))
    except (ValueError, IndexError):
        return None


def _parse_minutes(value: str) -> int:
    try:
        return max(0, int(value or 0))
    except ValueError:
        return 0


def _normalize_priority(value: str) -> str:
    return value if value in PRIORITY_LABELS else "medium"


def _group_key(due_date, overdue: bool, done: bool) -> str:
    if done:
        return "done"
    if due_date is None:
        return "nodate"
    if overdue:
        return "overdue"
    today = date.today()
    if due_date == today:
        return "today"
    if due_date == today + timedelta(days=1):
        return "tomorrow"
    if due_date <= today + timedelta(days=7):
        return "week"
    return "later"


def _format_task(row):
    task = dict(row)
    due_date = task.get("due_date")
    due_time = task.get("due_time")
    done = bool(task.get("done"))
    remind = bool(task.get("remind"))
    remind_minutes = _parse_minutes(task.get("remind_minutes"))
    task["remind_minutes"] = remind_minutes
    task["done"] = done

    priority = _normalize_priority(task.get("priority") or "medium")
    task["priority"] = priority
    task["priority_label"] = PRIORITY_LABELS[priority]
    task["priority_rank"] = PRIORITY_RANK[priority]

    when_parts = []
    if due_date:
        when_parts.append(due_date.strftime("%d.%m.%Y"))
    if due_time:
        when_parts.append(due_time.strftime("%H:%M"))
    task["when_label"] = " · ".join(when_parts) if when_parts else "Без срока"
    task["remind_label"] = REMIND_LABELS.get(remind_minutes, f"за {remind_minutes} мин")

    now = datetime.now()
    overdue = False
    if not done and due_date:
        if due_time:
            overdue = datetime.combine(due_date, due_time) < now
        else:
            overdue = due_date < now.date()
    task["overdue"] = overdue

    remind_at_iso = None
    if remind and not done and due_date and due_time:
        due_dt = datetime.combine(due_date, due_time)
        remind_at_iso = (due_dt - timedelta(minutes=remind_minutes)).isoformat()
    task["remind_at_iso"] = remind_at_iso

    task["group"] = _group_key(due_date, overdue, done)
    # Значения для полей формы редактирования и сортировки.
    task["due_date"] = due_date.isoformat() if due_date else ""
    task["due_time"] = due_time.strftime("%H:%M") if due_time else ""
    return task


def _sort_key(task):
    return (
        GROUP_ORDER.index(task["group"]),
        task["due_date"] or "9999-99-99",
        task["due_time"] or "99:99",
        task["priority_rank"],
        task["id"],
    )


def list_tasks():
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, title, due_date, due_time, remind, remind_minutes,
                       priority, done
                FROM tasks
                """
            )
            tasks = [_format_task(row) for row in cur.fetchall()]
    tasks.sort(key=_sort_key)
    return tasks


def group_tasks(tasks):
    buckets = {key: [] for key in GROUP_ORDER}
    for task in tasks:
        buckets[task["group"]].append(task)
    return [
        {
            "key": key,
            "label": GROUP_LABELS[key],
            "icon": GROUP_ICONS[key],
            "tasks": buckets[key],
        }
        for key in GROUP_ORDER
        if buckets[key]
    ]


def build_stats(tasks):
    today = date.today().isoformat()
    today_tasks = [t for t in tasks if t["due_date"] == today]
    today_done = [t for t in today_tasks if t["done"]]
    open_tasks = [t for t in tasks if not t["done"]]
    done_count = len(tasks) - len(open_tasks)
    by_priority = {
        "medium": len([t for t in open_tasks if t["priority"] == "medium"]),
        "important": len([t for t in open_tasks if t["priority"] == "important"]),
        "critical": len([t for t in open_tasks if t["priority"] == "critical"]),
    }
    return {
        "total": len(tasks),
        "open": len(open_tasks),
        "done": done_count,
        "today_total": len(today_tasks),
        "today_done": len(today_done),
        "today_open": len(today_tasks) - len(today_done),
        "today_percent": round(len(today_done) / len(today_tasks) * 100) if today_tasks else 0,
        "overdue": len([t for t in tasks if t["overdue"]]),
        "critical_open": by_priority["critical"],
        "completion_rate": round(done_count / len(tasks) * 100) if tasks else 0,
        "by_priority": by_priority,
        "next_task": next((t for t in open_tasks if t["due_date"]), None),
    }


def add_task(title, due_date, due_time, remind, remind_minutes, priority):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tasks (title, due_date, due_time, remind, remind_minutes, priority)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (title, due_date, due_time, remind, remind_minutes, priority),
            )
        conn.commit()


def update_task(task_id, title, due_date, due_time, remind, remind_minutes, priority):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tasks
                SET title = %s, due_date = %s, due_time = %s,
                    remind = %s, remind_minutes = %s, priority = %s
                WHERE id = %s
                """,
                (title, due_date, due_time, remind, remind_minutes, priority, task_id),
            )
        conn.commit()


def toggle_task(task_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE tasks
                SET done = NOT done,
                    done_at = CASE WHEN done THEN NULL ELSE NOW() END
                WHERE id = %s
                """,
                (task_id,),
            )
        conn.commit()


def delete_task(task_id):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tasks WHERE id = %s", (task_id,))
        conn.commit()


def clear_done():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tasks WHERE done")
        conn.commit()


@app.route("/")
def index():
    tasks = list_tasks()
    task_counts = {}
    for task in tasks:
        if task["due_date"] and not task["done"]:
            task_counts[task["due_date"]] = task_counts.get(task["due_date"], 0) + 1
    return render_template(
        "index.html",
        groups=group_tasks(tasks),
        stats=build_stats(tasks),
        task_counts=task_counts,
        priority_labels=PRIORITY_LABELS,
        remind_options=sorted(REMIND_LABELS.items()),
    )


@app.route("/add", methods=["POST"])
def add():
    title = request.form.get("task", "").strip()
    if title:
        add_task(
            title,
            _parse_date(request.form.get("due_date", "")),
            _parse_time(request.form.get("due_time", "")),
            request.form.get("remind") == "1",
            _parse_minutes(request.form.get("remind_minutes")),
            _normalize_priority(request.form.get("priority", "medium")),
        )
    return redirect("/")


@app.route("/edit/<int:task_id>", methods=["POST"])
def edit(task_id):
    title = request.form.get("task", "").strip()
    if title:
        update_task(
            task_id,
            title,
            _parse_date(request.form.get("due_date", "")),
            _parse_time(request.form.get("due_time", "")),
            request.form.get("remind") == "1",
            _parse_minutes(request.form.get("remind_minutes")),
            _normalize_priority(request.form.get("priority", "medium")),
        )
    return redirect("/")


@app.route("/toggle/<int:task_id>", methods=["POST"])
def toggle(task_id):
    toggle_task(task_id)
    return redirect("/")


@app.route("/delete/<int:task_id>", methods=["POST"])
def delete(task_id):
    delete_task(task_id)
    return redirect("/")


@app.route("/clear-done", methods=["POST"])
def clear():
    clear_done()
    return redirect("/")


@app.route("/api/reminders")
def reminders_api():
    now = datetime.now()
    return jsonify(
        [
            {
                "id": task["id"],
                "title": task["title"],
                "remind_at": task["remind_at_iso"],
                "due": task["when_label"],
                "priority": task["priority"],
                "is_due": datetime.fromisoformat(task["remind_at_iso"]) <= now,
            }
            for task in list_tasks()
            if task["remind_at_iso"]
        ]
    )


@app.route("/health")
def health():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return {"status": "ok"}, 200
    except Exception:
        return {"status": "error"}, 503


# Схема создаётся при импорте модуля, чтобы работало и под gunicorn,
# а не только при запуске через `python app.py`.
init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
