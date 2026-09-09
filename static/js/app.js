"use strict";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const VIEWS = {
    myday: {
        title: "Мой день",
        match: (t) => !t.done && t.date === today(),
        empty: ["На сегодня всё чисто", "Ни одной задачи на сегодня — можно выдохнуть."]
    },
    important: {
        title: "Важно",
        match: (t) => !t.done && (t.priority === "important" || t.priority === "critical"),
        empty: ["Важных задач нет", "Отметь задачу как «Важная», и она появится здесь."]
    },
    planned: {
        title: "Запланировано",
        match: (t) => !t.done && Boolean(t.date),
        empty: ["Планов пока нет", "Поставь задаче дату — и она попадёт в этот список."]
    },
    tasks: {
        title: "Все задачи",
        match: (t) => !t.done,
        empty: ["Список пуст", "Добавь первую задачу — кнопка «Новая задача» выше."]
    },
    done: {
        title: "Выполнено",
        match: (t) => t.done,
        empty: ["Ещё ничего не выполнено", "Нажми на кружок слева от задачи, чтобы закрыть её."]
    }
};

const { taskCounts } = window.APP_DATA;
const REMIND_TIMES = 4;
const REMIND_GAP_MS = 20000;
const REMIND_WINDOW_MS = 8 * 60 * 1000;

function loadReminderLog() {
    try {
        const raw = JSON.parse(localStorage.getItem("firedReminders") || "{}");
        if (Array.isArray(raw)) {
            return Object.fromEntries(raw.map((k) => [k, { n: REMIND_TIMES, last: Date.now() }]));
        }
        return raw && typeof raw === "object" ? raw : {};
    } catch (_) {
        return {};
    }
}

const reminderLog = loadReminderLog();
const reminderQueues = new Set();

function saveReminderLog() {
    localStorage.setItem("firedReminders", JSON.stringify(reminderLog));
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const pad = (n) => String(n).padStart(2, "0");
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function today() {
    return toISODate(new Date());
}

let currentView = "myday";
let selectedDate = null;
let searchQuery = "";
let viewYear;
let viewMonth;
let audioCtx = null;

/* -------------------------------------------------------------------------
   Тема
   ------------------------------------------------------------------------- */

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === "dark";
    $("#theme-label").textContent = dark ? "Светлая тема" : "Тёмная тема";
    $("#theme-icon").querySelector("use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
    $("#theme-toggle").setAttribute("aria-pressed", String(dark));
    localStorage.setItem("theme", theme);
}

function initTheme() {
    const saved = localStorage.getItem("theme");
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(saved || preferred);
    $("#theme-toggle").addEventListener("click", () => {
        applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
}

/* -------------------------------------------------------------------------
   Часы
   ------------------------------------------------------------------------- */

function pluralTasks(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "задача";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задачи";
    return "задач";
}

function updateClock() {
    const now = new Date();
    const dateLine = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    $("#digital-time").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    $("#digital-date").textContent = dateLine;
    $("#hero-date").textContent = dateLine;
}

/* -------------------------------------------------------------------------
   Фильтрация списка
   ------------------------------------------------------------------------- */

function taskState(el) {
    return {
        date: el.dataset.date,
        priority: el.dataset.priority,
        done: el.dataset.done === "1",
        title: (el.dataset.title || "").toLowerCase()
    };
}

function matchesSearch(state) {
    return !searchQuery || state.title.includes(searchQuery);
}

function applyFilters() {
    const view = VIEWS[currentView];
    const items = $$(".task");
    let visible = 0;

    items.forEach((el) => {
        const state = taskState(el);
        const inView = view.match(state) || Boolean(searchQuery && state.done);
        const show = inView
            && (!selectedDate || state.date === selectedDate)
            && matchesSearch(state);
        el.hidden = !show;
        if (show) visible += 1;
    });

    // Заголовок группы без видимых задач только мешает — убираем секцию целиком.
    $$(".group").forEach((group) => {
        const shown = [...group.querySelectorAll(".task")].filter((el) => !el.hidden);
        group.hidden = shown.length === 0;
        group.querySelector(".group-count").textContent = shown.length;
        shown.forEach((el, i) => el.style.setProperty("--i", i));
    });

    $("#hero-title").textContent = searchQuery ? "Поиск" : view.title;
    $("#list-title").textContent = searchQuery
        ? "Результаты поиска"
        : selectedDate
            ? `На ${selectedDate.split("-").reverse().join(".")}`
            : view.title;
    $("#list-meta").textContent = visible ? `${visible} ${pluralTasks(visible)}` : "";
    document.title = `${searchQuery ? "Поиск" : view.title} — Задачи`;

    const empty = $("#empty-msg");
    empty.hidden = visible > 0;
    if (visible === 0) {
        let title;
        let sub;
        if (searchQuery) {
            title = "Ничего не найдено";
            sub = `По запросу «${searchQuery}» нет ни открытых, ни выполненных задач.`;
        } else if (selectedDate) {
            title = "На эту дату задач нет";
            sub = "Выбери другой день или сбрось фильтр даты.";
        } else {
            [title, sub] = view.empty;
        }
        $("#empty-title").textContent = title;
        $("#empty-sub").textContent = sub;
    }

    const states = items.map(taskState);
    Object.entries(VIEWS).forEach(([key, cfg]) => {
        const badge = $(`[data-count="${key}"]`);
        const count = states.filter(cfg.match).length;
        badge.textContent = count;
        badge.dataset.empty = count === 0 ? "1" : "0";
    });

    const left = states.filter(VIEWS.myday.match).length;
    if (searchQuery) {
        const doneHits = states.filter((t) => t.done && matchesSearch(t)).length;
        $("#hero-sub").textContent = visible
            ? `${visible} ${pluralTasks(visible)}, из них выполненных: ${doneHits}`
            : "Ни открытых, ни выполненных задач не найдено";
    } else if (currentView === "myday") {
        $("#hero-sub").textContent = left
            ? `На сегодня осталось ${left} ${pluralTasks(left)}`
            : "На сегодня всё выполнено";
    } else {
        const inView = states.filter(view.match).length;
        $("#hero-sub").textContent = inView
            ? `${inView} ${pluralTasks(inView)} в этом списке`
            : view.empty[0];
    }
}

function initNav() {
    $$(".nav-item[data-view]").forEach((btn) => {
        btn.addEventListener("click", () => {
            $$(".nav-item[data-view]").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            currentView = btn.dataset.view;
            selectedDate = null;
            renderCalendar();
            applyFilters();
        });
    });
}

function initSearch() {
    const input = $("#task-search");
    input.addEventListener("input", () => {
        searchQuery = input.value.trim().toLowerCase();
        applyFilters();
    });
    window.addEventListener("keydown", (e) => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        input.focus();
    });
}

/* -------------------------------------------------------------------------
   Формы: раскрытие, тумблер напоминания, редактирование
   ------------------------------------------------------------------------- */

function initForms() {
    const tile = $("#add-tile");
    const toggle = $("#add-toggle");
    toggle.addEventListener("click", () => {
        const open = tile.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
        if (open) tile.querySelector('input[name="task"]').focus();
    });

    // Селект «за сколько напомнить» активен только при включённом напоминании.
    $$("[data-remind-toggle]").forEach((checkbox) => {
        const select = checkbox.closest(".meta-row").querySelector("[data-remind-select]");
        checkbox.addEventListener("change", () => {
            select.disabled = !checkbox.checked;
            if (!checkbox.checked) return;
            ensureAudio();
            requestNotifyPermission().then(updateNotifyStatus);
        });
    });

    $$("[data-edit]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const task = btn.closest(".task");
            const form = task.querySelector(".task-edit");
            form.hidden = !form.hidden;
            if (!form.hidden) form.querySelector('input[name="task"]').focus();
        });
    });

    $$("[data-cancel-edit]").forEach((btn) => {
        btn.addEventListener("click", () => { btn.closest(".task-edit").hidden = true; });
    });

    const dueDate = $("#add-due_date");
    if (!dueDate.value) dueDate.value = today();
}

/* -------------------------------------------------------------------------
   Календарь
   ------------------------------------------------------------------------- */

function tipText(iso) {
    const n = taskCounts[iso] || 0;
    return n === 0 ? "Нет задач" : `${n} ${pluralTasks(n)}`;
}

function showDayTip(btn, iso) {
    const tip = $("#day-tip");
    tip.textContent = tipText(iso);
    tip.classList.add("show");
    const rect = btn.getBoundingClientRect();
    const left = clamp(rect.left + rect.width / 2 - tip.offsetWidth / 2, 8,
        window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${left}px`;
    tip.style.top = `${rect.top - tip.offsetHeight - 8}px`;
}

function renderCalendar() {
    const first = new Date(viewYear, viewMonth, 1);
    const start = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevDays = new Date(viewYear, viewMonth, 0).getDate();
    const todayISO = today();

    let html = `
      <div class="cal-head">
        <div class="cal-title">${MONTHS[viewMonth]} ${viewYear}</div>
        <div class="cal-nav">
          <button type="button" data-dir="-1" aria-label="Предыдущий месяц">‹</button>
          <button type="button" data-dir="1" aria-label="Следующий месяц">›</button>
        </div>
      </div>
      <div class="cal-weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="cal-days">`;

    for (let i = 0; i < 42; i++) {
        let dayNum;
        let y = viewYear;
        let m = viewMonth;
        let muted = false;

        if (i < start) {
            dayNum = prevDays - start + i + 1;
            m -= 1;
            if (m < 0) { m = 11; y -= 1; }
            muted = true;
        } else if (i >= start + daysInMonth) {
            dayNum = i - start - daysInMonth + 1;
            m += 1;
            if (m > 11) { m = 0; y += 1; }
            muted = true;
        } else {
            dayNum = i - start + 1;
        }

        const iso = `${y}-${pad(m + 1)}-${pad(dayNum)}`;
        const classes = [
            muted ? "muted" : "",
            iso === todayISO ? "today" : "",
            selectedDate === iso ? "selected" : "",
            (taskCounts[iso] || 0) > 0 ? "has-task" : ""
        ].filter(Boolean).join(" ");
        html += `<button type="button" class="${classes}" data-date="${iso}">${dayNum}</button>`;
    }

    $("#calendar").innerHTML = `${html}</div>`;

    $$("#calendar [data-dir]").forEach((btn) => {
        btn.addEventListener("click", () => {
            viewMonth += Number(btn.dataset.dir);
            if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
            if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
            renderCalendar();
        });
    });

    $$("#calendar .cal-days button").forEach((btn) => {
        btn.addEventListener("click", () => {
            selectedDate = btn.dataset.date;
            $("#add-due_date").value = selectedDate;
            renderCalendar();
            applyFilters();
        });
        btn.addEventListener("mouseenter", () => showDayTip(btn, btn.dataset.date));
        btn.addEventListener("mouseleave", () => $("#day-tip").classList.remove("show"));
    });
}

/* -------------------------------------------------------------------------
   Напоминания
   ------------------------------------------------------------------------- */

function ensureAudio() {
    if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
}

function playNotifySound(force = false) {
    if (!force && !$("#sound-enabled").checked) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Три пары тонов подряд — один короткий писк легко пропустить.
    for (let burst = 0; burst < 3; burst++) {
        const t0 = now + burst * 0.78;
        [[880, 0], [1318.5, 0.13]].forEach(([freq, delay]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.value = freq;
            const t = t0 + delay;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.45);
        });
    }
}

function showBrowserNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
        new Notification(title, { body, silent: true });
    } catch (_) {
        /* HTTP без localhost: конструктор может бросить ошибку */
    }
}

function notifyState() {
    if (!("Notification" in window)) return "unsupported";
    if (!window.isSecureContext) return "insecure";
    return Notification.permission;
}

function updateNotifyStatus() {
    const status = $("#notify-status");
    const text = $("#notify-status-text");
    const btn = $("#notify-enable");
    const label = $("#notify-enable-label");
    const state = notifyState();
    status.dataset.state = state;

    const copy = {
        granted: "Уведомления разрешены — напоминания придут и если вкладка в фоне.",
        denied: "Браузер заблокировал всплывающие окна. Разреши их в настройках сайта.",
        default: "Нажми «Разрешить», чтобы видеть напоминания вне вкладки.",
        insecure: "Системные уведомления работают на localhost или HTTPS. Звук и тост на странице — и так.",
        unsupported: "Этот браузер не умеет системные уведомления. Звук и тост всё равно сработают."
    };
    const body = copy[state] || "";
    status.hidden = !body;
    text.textContent = body;
    btn.hidden = state === "granted" || state === "unsupported";
    if (state === "denied") label.textContent = "Уведомления заблокированы";
    else label.textContent = "Разрешить уведомления";
}

async function requestNotifyPermission() {
    const state = notifyState();
    if (state === "insecure") {
        showToast("Уведомления браузера", "Открой сайт как localhost или по HTTPS — иначе браузер их блокирует.");
        updateNotifyStatus();
        return;
    }
    if (state === "denied") {
        showToast("Уведомления заблокированы", "В адресной строке открой значок замка → Уведомления → Разрешить.");
        return;
    }
    if (!("Notification" in window) || state !== "default") {
        updateNotifyStatus();
        return;
    }
    try {
        await Notification.requestPermission();
    } catch (_) { /* ignore */ }
    updateNotifyStatus();
    if (Notification.permission === "granted") {
        playNotifySound(true);
        showToast("Готово", "Напоминания будут приходить во всплывающем окне.");
        showBrowserNotification("Уведомления включены", "Так будет выглядеть напоминание о задаче.");
    }
}

function testNotify() {
    ensureAudio();
    playNotifySound(true);
    const state = notifyState();
    if (state === "granted") {
        showToast("Проверка", "Звук, тост и системное уведомление.");
        showBrowserNotification("Проверка", "Если видишь это — уведомления работают.");
        return;
    }
    if (state === "insecure") {
        showToast("Проверка звука", "Звук и тост работают. Системные уведомления — только на localhost или HTTPS.");
        return;
    }
    if (state === "denied") {
        showToast("Проверка звука", "Звук есть. Системные уведомления заблокированы в браузере.");
        return;
    }
    showToast("Проверка звука", "Звук есть. Нажми «Разрешить уведомления», чтобы проверить всплывающее окно.");
}

function initNotify() {
    updateNotifyStatus();
    $("#notify-enable").addEventListener("click", requestNotifyPermission);
    $("#notify-test").addEventListener("click", testNotify);
}

function showToast(title, body, ms = 6000) {
    const toast = $("#toast");
    $("#toast-title").textContent = title;
    $("#toast-body").textContent = body;
    toast.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove("show"), ms);
}

function fireReminderAlert(title) {
    playNotifySound();
    showToast("Напоминание", title, 10000);
    showBrowserNotification("Напоминание", title);
}

function queueReminder(key, title, delay) {
    if (reminderQueues.has(key)) return;
    reminderQueues.add(key);

    const tick = () => {
        const current = reminderLog[key] || { n: 0, last: 0 };
        if (current.n >= REMIND_TIMES) {
            reminderQueues.delete(key);
            return;
        }
        fireReminderAlert(title);
        reminderLog[key] = { n: current.n + 1, last: Date.now() };
        saveReminderLog();
        if (reminderLog[key].n < REMIND_TIMES) {
            setTimeout(tick, REMIND_GAP_MS);
        } else {
            reminderQueues.delete(key);
        }
    };

    setTimeout(tick, delay);
}

function checkReminders() {
    const now = Date.now();
    $$(".task[data-remind-at]").forEach((el) => {
        const at = el.dataset.remindAt;
        if (!at) return;
        const key = `${el.dataset.id}:${at}`;
        const ts = Date.parse(at);
        if (Number.isNaN(ts) || ts > now || now - ts > REMIND_WINDOW_MS) return;

        const log = reminderLog[key] || { n: 0, last: 0 };
        if (log.n >= REMIND_TIMES || reminderQueues.has(key)) return;

        const wait = log.n === 0 ? 0 : Math.max(0, REMIND_GAP_MS - (now - log.last));
        queueReminder(key, el.dataset.title || "Задача", wait);
    });
}

/* -------------------------------------------------------------------------
   Перетаскивание виджета
   ------------------------------------------------------------------------- */

function placeWidget(el, x, y) {
    const left = clamp(x, 8, Math.max(8, window.innerWidth - el.offsetWidth - 8));
    const top = clamp(y, 8, Math.max(8, window.innerHeight - el.offsetHeight - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    return { left, top };
}

function makeDraggable(el) {
    const handle = el.querySelector("[data-drag]");
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    const onDown = (x, y) => {
        dragging = true;
        el.classList.add("dragging");
        const rect = el.getBoundingClientRect();
        startX = x; startY = y;
        origLeft = rect.left; origTop = rect.top;
    };
    const onMove = (x, y) => {
        if (!dragging) return;
        const pos = placeWidget(el, origLeft + x - startX, origTop + y - startY);
        localStorage.setItem(el.dataset.storage, JSON.stringify(pos));
    };
    const onUp = () => { dragging = false; el.classList.remove("dragging"); };

    handle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onDown(e.clientX, e.clientY);
    });
    window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
    window.addEventListener("mouseup", onUp);
    handle.addEventListener("touchstart", (e) => onDown(e.touches[0].clientX, e.touches[0].clientY),
        { passive: true });
    window.addEventListener("touchmove", (e) => {
        if (dragging) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener("touchend", onUp);
}

function initWidget() {
    const widget = $("#calendar-widget");
    const fallback = () => placeWidget(widget, window.innerWidth - 254, 90);
    try {
        const raw = localStorage.getItem(widget.dataset.storage);
        if (raw) {
            const pos = JSON.parse(raw);
            placeWidget(widget, pos.left, pos.top);
        } else {
            fallback();
        }
    } catch (_) {
        fallback();
    }
    makeDraggable(widget);

    window.addEventListener("resize", () => {
        const rect = widget.getBoundingClientRect();
        localStorage.setItem(widget.dataset.storage,
            JSON.stringify(placeWidget(widget, rect.left, rect.top)));
    });
}

/* -------------------------------------------------------------------------
   Старт
   ------------------------------------------------------------------------- */

const now = new Date();
viewYear = now.getFullYear();
viewMonth = now.getMonth();

initTheme();
initNav();
initSearch();
initForms();
initNotify();
initWidget();
renderCalendar();
updateClock();
applyFilters();

$("#show-all").addEventListener("click", () => {
    selectedDate = null;
    renderCalendar();
    applyFilters();
});

["click", "keydown", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, ensureAudio, { once: true, passive: true });
});

setInterval(updateClock, 1000);
checkReminders();
setInterval(checkReminders, 5000);
