/**
 * КБ Контроль — ежедневный чеклист для контроля строительных работ.
 *
 * Архитектура:
 * - Данные хранятся в window.storage (persistent storage) по ключу "day:YYYY-MM-DD"
 * - Каждый день: массив задач (status + comment), итог дня, проблемы дня
 * - Автосохранение через 400мс debounce после изменения
 * - Экспорт в Excel через библиотеку xlsx
 *
 * Навигация:
 * - "Сегодня" — редактируемый текущий день
 * - "Архив" — все сохранённые дни (только просмотр)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";

/* ═══ КОНСТАНТЫ — список ежедневных задач ═══ */

const TASKS = [
  { time: "09:00", name: "Обход объекта, проверка явки, составление плана работ с подрядчиками" },
  { time: "09:20", name: "Подсчет склада, распоряжение материалом" },
  { time: "09:40", name: "Фотоотчет в ТГ каналы каждой комнаты (есть изменения / нет)" },
  { time: "09:50", name: "Составление заявок по материалу и инструменту" },
  { time: "10:00", name: "Проблемы и их решения" },
  { time: "10:10", name: "Заполнение таблиц (склад, контроль, ход)" },
  { time: "12:00", name: "Отправка скриншотов владельцу" },
  { time: "12:05", name: "Распределение фотоотчета для каналов владельца" },
  { time: "17:00", name: "ППР_Баня_ход_работ — обновление статусов" },
  { time: "17:45", name: "Скрин хода работ → ТГ: Ход работ" },
  { time: "17:50", name: "Итог дня → ТГ: ИТОГ ДНЯ" },
  { time: "18:00", name: "Учёт склада — подсчет на конец дня" },
  { time: "18:30", name: "Сверка склада: начало + приход − расход = конец" },
  { time: "∞", name: "Контроль хода работ на площадке" },
  { time: "∞", name: "Приёмка материалов (если поставка)" },
  { time: "∞", name: "Контроль рабочих — факт работ (вечер)" },
];

const TOTAL_TASKS = TASKS.length;

/* ═══ УТИЛИТЫ — работа с датами ═══ */

/** Возвращает сегодняшнюю дату: "YYYY-MM-DD" */
function getToday() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** Форматирует "2025-03-02" → "2 мар 2025" */
function formatDateRu(dateStr) {
  const [y, m, d] = dateStr.split("-");
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

/** Сокращённый день недели: "Пн", "Вт" и т.д. */
function weekdayRu(dateStr) {
  const days = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  return days[new Date(dateStr + "T00:00:00").getDay()];
}

/** Пустая структура дня: все задачи без статуса */
function emptyDay() {
  return {
    tasks: TASKS.map(() => ({ status: null, comment: "" })),
    summary: "",
    problems: "",
  };
}

/* ═══ КОМПОНЕНТЫ UI ═══ */

/** Часы реального времени, обновляются каждую секунду */
function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontVariantNumeric: "tabular-nums" }}>
      {now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

/** Полоса прогресса: done/total выполненных задач */
function ProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs tracking-widest uppercase" style={{ color: "#6ee7b7" }}>Прогресс</span>
        <span className="text-xs font-bold" style={{ color: done === total && total > 0 ? "#34d399" : "#a7f3d0", fontFamily: "'JetBrains Mono', monospace" }}>
          {done}/{total} — {pct}%
        </span>
      </div>
      <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.15)" }}>
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: pct + "%",
            background: done === total && total > 0
              ? "linear-gradient(90deg, #34d399, #6ee7b7)"
              : "linear-gradient(90deg, #059669, #10b981, #34d399)",
            boxShadow: "0 0 12px rgba(16,185,129,0.5)",
          }}
        />
      </div>
    </div>
  );
}

/** Кнопка статуса. Цикл: null → "done" (✅) → "fail" (❌) → null */
function StatusBtn({ status, onClick, disabled }) {
  const display = status === "done" ? "✅" : status === "fail" ? "❌" : "○";
  const bg = status === "done"
    ? "rgba(16,185,129,0.15)"
    : status === "fail"
    ? "rgba(239,68,68,0.15)"
    : "rgba(255,255,255,0.04)";
  const border = status === "done"
    ? "rgba(16,185,129,0.4)"
    : status === "fail"
    ? "rgba(239,68,68,0.4)"
    : "rgba(255,255,255,0.08)";
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="flex items-center justify-center rounded-lg transition-all duration-200 active:scale-90 select-none shrink-0"
      style={{
        width: 48, height: 48, minWidth: 48,
        background: bg,
        border: `1.5px solid ${border}`,
        fontSize: status ? 22 : 18,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        color: !status ? "rgba(255,255,255,0.2)" : undefined,
      }}
    >
      {display}
    </button>
  );
}

/** Строка задачи: кнопка статуса + название + раскрывающийся комментарий.
 *  task.time === "∞" — задача без фиксированного времени. */
function TaskRow({ task, index, data, onChange, readOnly }) {
  const { status, comment } = data;
  const [open, setOpen] = useState(false);
  const isAllDay = task.time === "∞";

  function cycleStatus() {
    if (readOnly) return;
    const next = status === null ? "done" : status === "done" ? "fail" : null;
    onChange(index, "status", next);
  }

  return (
    <div
      className="rounded-xl transition-all duration-300"
      style={{
        background: status === "done"
          ? "linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))"
          : status === "fail"
          ? "linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.02))"
          : "rgba(255,255,255,0.02)",
        border: `1px solid ${status === "done" ? "rgba(16,185,129,0.15)" : status === "fail" ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.05)"}`,
        marginBottom: 8,
      }}
    >
      <div className="flex items-center gap-3 p-3" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <StatusBtn status={status} onClick={(e) => { e.stopPropagation(); cycleStatus(); }} disabled={readOnly} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-md shrink-0"
              style={{
                background: isAllDay ? "rgba(251,191,36,0.12)" : "rgba(16,185,129,0.1)",
                color: isAllDay ? "#fbbf24" : "#6ee7b7",
                border: `1px solid ${isAllDay ? "rgba(251,191,36,0.2)" : "rgba(16,185,129,0.2)"}`,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {isAllDay ? "В ТЕЧЕНИЕ ДНЯ" : task.time}
            </span>
          </div>
          <p className="text-sm leading-snug" style={{ color: status === "done" ? "rgba(167,243,208,0.7)" : "rgba(255,255,255,0.8)" }}>
            {task.name}
          </p>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none"
          className="shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", opacity: 0.3 }}
        >
          <path d="M4 6l4 4 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <textarea
            placeholder="Комментарий..."
            value={comment}
            readOnly={readOnly}
            onChange={(e) => onChange(index, "comment", e.target.value)}
            className="w-full rounded-lg p-3 text-sm resize-none outline-none transition-all duration-200"
            style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(16,185,129,0.1)",
              color: "rgba(255,255,255,0.85)",
              minHeight: 60,
            }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(16,185,129,0.4)"; }}
            onBlur={(e) => { e.target.style.borderColor = "rgba(16,185,129,0.1)"; }}
          />
        </div>
      )}
    </div>
  );
}

/* ═══ КОРНЕВОЙ КОМПОНЕНТ ═══ */

export default function App() {
  // view: "today" | "archive" | "YYYY-MM-DD" (конкретная архивная дата)
  const [view, setView] = useState("today");
  // days: { "YYYY-MM-DD": { tasks, summary, problems } }
  const [days, setDays] = useState({});
  const [archiveKeys, setArchiveKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);
  const today = getToday();
  const activeDate = view === "today" ? today : view === "archive" ? null : view;
  const readOnly = activeDate && activeDate !== today;

  useEffect(() => {
    (async () => {
      try {
        let todayData;
        try {
          const res = await window.storage.get(`day:${today}`);
          todayData = res ? JSON.parse(res.value) : null;
        } catch { todayData = null; }

        let keys = [];
        try {
          const res = await window.storage.list("day:");
          keys = res?.keys || [];
        } catch {}

        const loaded = {};
        if (todayData) loaded[today] = todayData;
        else loaded[today] = emptyDay();

        for (const k of keys) {
          const date = k.replace("day:", "");
          if (date !== today && !loaded[date]) {
            try {
              const r = await window.storage.get(k);
              if (r) loaded[date] = JSON.parse(r.value);
            } catch {}
          }
        }

        setDays(loaded);
        setArchiveKeys(keys.map((k) => k.replace("day:", "")).sort().reverse());
      } catch (e) {
        console.error(e);
        setDays({ [today]: emptyDay() });
        setArchiveKeys([]);
      }
      setLoading(false);
    })();
  }, [today]);

  const save = useCallback(
    async (date, data) => {
      setSaving(true);
      try {
        await window.storage.set(`day:${date}`, JSON.stringify(data));
      } catch (e) {
        console.error("Save error:", e);
      }
      setTimeout(() => setSaving(false), 600);
    },
    []
  );

  function updateTask(index, field, value) {
    if (readOnly || !activeDate) return;
    setDays((prev) => {
      const day = { ...(prev[activeDate] || emptyDay()) };
      const tasks = [...day.tasks];
      tasks[index] = { ...tasks[index], [field]: value };
      day.tasks = tasks;
      const next = { ...prev, [activeDate]: day };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(activeDate, day), 400);
      if (!archiveKeys.includes(activeDate)) {
        setArchiveKeys((ak) => [activeDate, ...ak].sort().reverse());
      }
      return next;
    });
  }

  function updateField(field, value) {
    if (readOnly || !activeDate) return;
    setDays((prev) => {
      const day = { ...(prev[activeDate] || emptyDay()), [field]: value };
      const next = { ...prev, [activeDate]: day };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(activeDate, day), 400);
      if (!archiveKeys.includes(activeDate)) {
        setArchiveKeys((ak) => [activeDate, ...ak].sort().reverse());
      }
      return next;
    });
  }

  function exportExcel(date) {
    const day = days[date];
    if (!day) return;
    const rows = TASKS.map((t, i) => ({
      "Дата": date,
      "Время": t.time === "∞" ? "В течение дня" : t.time,
      "Задача": t.name,
      "Статус": day.tasks[i]?.status === "done" ? "✅ Выполнено" : day.tasks[i]?.status === "fail" ? "❌ Не выполнено" : "— Не заполнено",
      "Комментарий": day.tasks[i]?.comment || "",
    }));
    rows.push({ "Дата": "", "Время": "", "Задача": "", "Статус": "", "Комментарий": "" });
    rows.push({ "Дата": date, "Время": "", "Задача": "ИТОГ ДНЯ", "Статус": "", "Комментарий": day.summary || "" });
    rows.push({ "Дата": date, "Время": "", "Задача": "ПРОБЛЕМЫ ДНЯ", "Статус": "", "Комментарий": day.problems || "" });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 55 }, { wch: 18 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Чеклист");
    XLSX.writeFile(wb, `Чеклист_КБ_${date}.xlsx`);
  }

  async function loadArchiveDay(date) {
    if (days[date]) {
      setView(date);
      return;
    }
    try {
      const res = await window.storage.get(`day:${date}`);
      if (res) {
        setDays((p) => ({ ...p, [date]: JSON.parse(res.value) }));
      }
    } catch {}
    setView(date);
  }

  const dayData = activeDate ? days[activeDate] || emptyDay() : null;
  const doneCount = dayData ? dayData.tasks.filter((t) => t.status === "done").length : 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0f1a" }}>
        <div className="text-center">
          <div className="inline-block w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mb-4" style={{ borderColor: "#10b981", borderTopColor: "transparent" }} />
          <p style={{ color: "#6ee7b7", fontSize: 14 }}>Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #060b16 0%, #0a1628 40%, #0d1a2d 100%)", color: "#e2e8f0" }}>
      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(16,185,129,0.06), transparent)",
      }} />

      <header className="sticky top-0 z-50 px-4 pt-4 pb-3" style={{
        background: "rgba(6,11,22,0.85)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(16,185,129,0.08)",
      }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#6ee7b7" }}>
                КБ Контроль
              </span>
            </div>
            <div className="flex items-center gap-3">
              {saving && <span className="text-xs" style={{ color: "rgba(16,185,129,0.6)" }}>●</span>}
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                <Clock />
              </span>
            </div>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setView("today")}
              className="flex-1 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-all duration-300"
              style={{
                background: (view === "today" || (view !== "archive" && activeDate === today))
                  ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${(view === "today" || (view !== "archive" && activeDate === today)) ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)"}`,
                color: (view === "today" || (view !== "archive" && activeDate === today)) ? "#6ee7b7" : "rgba(255,255,255,0.4)",
              }}
            >
              Сегодня
            </button>
            <button
              onClick={() => setView("archive")}
              className="flex-1 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-all duration-300"
              style={{
                background: view === "archive" ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${view === "archive" ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)"}`,
                color: view === "archive" ? "#6ee7b7" : "rgba(255,255,255,0.4)",
              }}
            >
              Архив
            </button>
            {activeDate && activeDate !== today && view !== "archive" && (
              <button
                onClick={() => setView("today")}
                className="px-3 py-2 rounded-lg text-xs transition-all"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}
              >
                ✕
              </button>
            )}
          </div>

          {activeDate && <ProgressBar done={doneCount} total={TOTAL_TASKS} />}
        </div>
      </header>

      <main className="px-4 pb-8 pt-4 max-w-lg mx-auto relative z-10">
        {view === "archive" && (
          <div>
            <h2 className="text-sm font-bold tracking-widest uppercase mb-4" style={{ color: "#6ee7b7" }}>
              Архив ({archiveKeys.length})
            </h2>
            {archiveKeys.length === 0 ? (
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Нет сохранённых дней</p>
            ) : (
              <div className="space-y-2">
                {archiveKeys.map((date) => {
                  const d = days[date];
                  const done = d ? d.tasks.filter((t) => t.status === "done").length : 0;
                  const pct = Math.round((done / TOTAL_TASKS) * 100);
                  const isToday = date === today;
                  return (
                    <button
                      key={date}
                      onClick={() => isToday ? setView("today") : loadArchiveDay(date)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 active:scale-[0.98]"
                      style={{
                        background: isToday ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isToday ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)"}`,
                      }}
                    >
                      <div className="text-left flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold" style={{ color: isToday ? "#6ee7b7" : "rgba(255,255,255,0.8)" }}>
                            {formatDateRu(date)}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{
                            background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)"
                          }}>
                            {weekdayRu(date)}
                          </span>
                          {isToday && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{
                              background: "rgba(16,185,129,0.15)", color: "#6ee7b7"
                            }}>
                              сегодня
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-bold shrink-0" style={{
                        color: pct === 100 ? "#34d399" : pct > 50 ? "#6ee7b7" : "rgba(255,255,255,0.4)",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        {pct}%
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeDate && view !== "archive" && dayData && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold" style={{ color: readOnly ? "rgba(255,255,255,0.5)" : "#f0fdf4" }}>
                  {formatDateRu(activeDate)}
                  <span className="ml-2 text-sm font-normal" style={{ color: "rgba(255,255,255,0.3)" }}>{weekdayRu(activeDate)}</span>
                </h2>
                {readOnly && (
                  <span className="text-xs" style={{ color: "#fbbf24" }}>🔒 Только просмотр</span>
                )}
              </div>
              <button
                onClick={() => exportExcel(activeDate)}
                className="px-3 py-2 rounded-lg text-xs font-bold transition-all duration-200 active:scale-95"
                style={{
                  background: "rgba(16,185,129,0.1)",
                  border: "1px solid rgba(16,185,129,0.25)",
                  color: "#6ee7b7",
                }}
              >
                ↓ Excel
              </button>
            </div>

            <div className="mb-6">
              {TASKS.map((task, i) => (
                <TaskRow
                  key={i}
                  task={task}
                  index={i}
                  data={dayData.tasks[i] || { status: null, comment: "" }}
                  onChange={updateTask}
                  readOnly={readOnly}
                />
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "#6ee7b7" }}>
                  Итог дня
                </label>
                <textarea
                  value={dayData.summary || ""}
                  readOnly={readOnly}
                  onChange={(e) => updateField("summary", e.target.value)}
                  placeholder="Краткий итог..."
                  className="w-full rounded-xl p-4 text-sm resize-none outline-none transition-all duration-200"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(16,185,129,0.1)",
                    color: "rgba(255,255,255,0.85)",
                    minHeight: 80,
                  }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(16,185,129,0.4)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(16,185,129,0.1)"; }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold tracking-widest uppercase mb-2" style={{ color: "#ef4444" }}>
                  Проблемы дня
                </label>
                <textarea
                  value={dayData.problems || ""}
                  readOnly={readOnly}
                  onChange={(e) => updateField("problems", e.target.value)}
                  placeholder="Проблема → Последствие → Решение..."
                  className="w-full rounded-xl p-4 text-sm resize-none outline-none transition-all duration-200"
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(239,68,68,0.1)",
                    color: "rgba(255,255,255,0.85)",
                    minHeight: 80,
                  }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.4)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.1)"; }}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
