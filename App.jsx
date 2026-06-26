import { useState, useRef, useEffect } from "react";

// ============================================================
// STORAGE
// ============================================================
const STORAGE_KEY = "marketing-os-v2";
const QUIZ_HISTORY_KEY = "marketing-os-quiz-history";

async function saveModules(modules) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(modules)); } catch (e) {}
}
async function loadModules() {
  try {
    const val = localStorage.getItem(STORAGE_KEY); const r = val ? { value: val } : null;
    if (r?.value) return JSON.parse(r.value);
  } catch (e) {}
  return null;
}
async function saveQuizHistory(history) {
  try { localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
}
async function loadQuizHistory() {
  try {
    const val = localStorage.getItem(QUIZ_HISTORY_KEY); const r = val ? { value: val } : null;
    if (r?.value) return JSON.parse(r.value);
  } catch (e) {}
  return [];
}

// ============================================================
// DATA
// ============================================================
const INITIAL_MODULES = [
  {
    id: "m1",
    title: "Обратная связь",
    lessons: [
      {
        id: "l1",
        title: "Урок 1: Как собирать фидбек",
        content: `Обратная связь — главный инструмент маркетолога. Ключевые принципы:
1. Фидбек собирается от реальных людей, а не из головы
2. Минимум 10 источников для статистической значимости
3. Три типа вопросов: открытые (что?), уточняющие (почему?), ранжирующие (насколько важно?)
4. Результат фидбека — не мнения, а паттерны: повторяющиеся темы и боли
5. Транзакционный анализ по Эрику Берну: три эго-состояния (Родитель, Взрослый, Ребёнок) влияют на то, как человек воспринимает сообщение
6. SABONE — фреймворк ценностей: Безопасность, Привязанность, Гордость, Новизна, Экономия, Комфорт
7. Топ-3 качества для развития выявляются через анализ фидбека от окружения, затем формируются SMART-действия под каждое`,
        mastery: 0,
        completed: true,
        lastReviewed: null,
      },
    ],
  },
];

const MASTERY_LABELS = ["Не начато", "Знакомо", "Понимаю", "Усвоено", "Эксперт"];
const MASTERY_COLORS = ["#3a3a4a", "#8b5cf6", "#3b82f6", "#10b981", "#f59e0b"];

// Interval repetition: days until next review per mastery level
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];

function getDaysUntilReview(lesson) {
  if (!lesson.lastReviewed) return 0;
  const interval = REVIEW_INTERVALS[lesson.mastery] || 30;
  const last = new Date(lesson.lastReviewed);
  const next = new Date(last.getTime() + interval * 86400000);
  const now = new Date();
  return Math.ceil((next - now) / 86400000);
}

function needsReview(lesson) {
  return getDaysUntilReview(lesson) <= 0 && lesson.mastery > 0;
}

// ============================================================
// API
// ============================================================
async function callClaude(messages, systemPrompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await response.json();
  return data.content?.map((b) => b.text || "").join("\n") || "Ошибка ответа";
}

function buildKnowledgeBase(modules) {
  return modules
    .map((m) =>
      `## Модуль: ${m.title}\n` +
      m.lessons.map((l) => `### ${l.title}\n${l.content}`).join("\n\n")
    )
    .join("\n\n---\n\n");
}

// PDF text extraction via canvas rendering
async function extractTextFromPDF(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        // Basic extraction: get readable text from binary
        const cleaned = text
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
        resolve(cleaned.length > 100 ? cleaned : null);
      } catch {
        resolve(null);
      }
    };
    reader.readAsBinaryString(file);
  });
}

async function extractTextFromFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "txt" || ext === "md") {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result.slice(0, 8000));
      reader.readAsText(file, "UTF-8");
    });
  }
  if (ext === "pdf") {
    return await extractTextFromPDF(file);
  }
  return null;
}

// ============================================================
// SHARED UI
// ============================================================
function MasteryBadge({ level }) {
  return (
    <span style={{
      background: MASTERY_COLORS[level], color: "#fff",
      fontSize: 11, padding: "3px 9px", borderRadius: 20,
      fontWeight: 600, whiteSpace: "nowrap",
    }}>
      {MASTERY_LABELS[level]}
    </span>
  );
}

function ProgressBar({ value, max, color = "#8b5cf6" }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div style={{ background: "#1e1e2e", borderRadius: 6, height: 5, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.4s" }} />
    </div>
  );
}

function Sheet({ visible, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      display: visible ? "flex" : "none",
      flexDirection: "column", background: "#0c0c18",
    }}>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 400,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#13131f", border: "1px solid #2d2d42",
        borderRadius: "16px 16px 0 0", padding: "24px 20px",
        width: "100%", maxWidth: 480,
      }}>
        <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 16, marginBottom: 16 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function BackHeader({ title, subtitle, onBack, right }) {
  return (
    <div style={{
      padding: "12px 14px", borderBottom: "1px solid #1e1e2e",
      background: "#0f0f1a", display: "flex", alignItems: "center", gap: 10,
      position: "sticky", top: 0, zIndex: 10, flexShrink: 0,
    }}>
      <button onClick={onBack} style={{
        background: "#1e1e35", border: "none", borderRadius: 8,
        color: "#a78bfa", width: 36, height: 36, fontSize: 20,
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>‹</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        {subtitle && <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 1 }}>{subtitle}</div>}
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

// ============================================================
// FILE UPLOAD BUTTON
// ============================================================
function FileUploadButton({ onTextExtracted, loading, setLoading }) {
  const inputRef = useRef(null);

  const handle = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const text = await extractTextFromFile(file);
    setLoading(false);
    if (text) {
      onTextExtracted(text, file.name);
    } else {
      alert("Не удалось извлечь текст. Попробуй .txt или .md файл.");
    }
    e.target.value = "";
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".txt,.md,.pdf" onChange={handle}
        style={{ display: "none" }} />
      <button onClick={() => inputRef.current?.click()} disabled={loading}
        style={{
          padding: "5px 12px", borderRadius: 8,
          background: loading ? "#1e1e35" : "#1e1e35",
          border: "1px solid #3b3b52", color: "#a78bfa",
          fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", gap: 4, opacity: loading ? 0.6 : 1,
        }}>
        {loading ? "⏳" : "📎"} {loading ? "Читаю..." : "Файл"}
      </button>
    </>
  );
}

// ============================================================
// LESSON SCREEN
// ============================================================
function LessonScreen({ module, lesson, onUpdateLesson, onBack, onOpenAI }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lesson.content);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    setDraft(lesson.content);
    setEditing(false);
  }, [lesson.id]);

  const save = () => {
    onUpdateLesson({ ...lesson, content: draft });
    setEditing(false);
  };

  const daysLeft = getDaysUntilReview(lesson);
  const reviewDue = needsReview(lesson);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <BackHeader
        title={lesson.title}
        subtitle={module.title}
        onBack={onBack}
        right={<MasteryBadge level={lesson.mastery} />}
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "16px", paddingBottom: 170 }}>

        {/* Review reminder */}
        {reviewDue && (
          <div style={{
            background: "#2d1b00", border: "1px solid #f59e0b",
            borderRadius: 10, padding: "10px 14px", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 20 }}>🔔</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13 }}>Пора повторить!</div>
              <div style={{ color: "#92400e", fontSize: 12, marginTop: 2 }}>Нажми «Проверка» — обнови уровень освоения</div>
            </div>
          </div>
        )}

        {!reviewDue && lesson.lastReviewed && daysLeft > 0 && (
          <div style={{
            background: "#0f1f0f", border: "1px solid #1e3a1e",
            borderRadius: 10, padding: "8px 14px", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>📅</span>
            <div style={{ color: "#6b7280", fontSize: 12 }}>
              Следующее повторение через <span style={{ color: "#10b981", fontWeight: 700 }}>{daysLeft} дн.</span>
            </div>
          </div>
        )}

        {/* Mastery */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 11, fontWeight: 600, marginBottom: 8, letterSpacing: 0.5 }}>УРОВЕНЬ ОСВОЕНИЯ</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {MASTERY_LABELS.map((label, i) => (
              <button key={i} onClick={() => onUpdateLesson({ ...lesson, mastery: i, lastReviewed: new Date().toISOString() })}
                style={{
                  padding: "6px 12px", borderRadius: 20,
                  background: lesson.mastery === i ? MASTERY_COLORS[i] : "#1e1e2e",
                  border: lesson.mastery === i ? "none" : "1px solid #2d2d42",
                  color: lesson.mastery === i ? "#fff" : "#6b7280",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Completed */}
        <label style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px", background: "#0f0f1a",
          borderRadius: 10, marginBottom: 14, cursor: "pointer",
        }}>
          <input type="checkbox" checked={lesson.completed}
            onChange={(e) => onUpdateLesson({ ...lesson, completed: e.target.checked })}
            style={{ width: 18, height: 18, accentColor: "#8b5cf6", cursor: "pointer" }} />
          <span style={{ color: "#94a3b8", fontSize: 14 }}>Урок просмотрен</span>
        </label>

        {/* Content */}
        <div style={{ background: "#0f0f1a", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          <div style={{
            padding: "12px 14px", borderBottom: "1px solid #1e1e2e",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ color: "#6b7280", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, flex: 1 }}>КОНСПЕКТ</span>
            {editing && (
              <FileUploadButton
                loading={fileLoading}
                setLoading={setFileLoading}
                onTextExtracted={(text, name) => {
                  setDraft((prev) => prev ? prev + "\n\n---\n📎 " + name + "\n" + text : text);
                }}
              />
            )}
            <button onClick={() => editing ? save() : setEditing(true)} style={{
              padding: "5px 12px", borderRadius: 8,
              background: editing ? "#7c3aed" : "#1e1e35",
              border: "none", color: "#e2e8f0", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>{editing ? "💾 Сохранить" : "✏️ Изменить"}</button>
          </div>
          {editing ? (
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{
              width: "100%", minHeight: 260, background: "#13131f", border: "none",
              color: "#e2e8f0", fontSize: 14, lineHeight: 1.7,
              padding: 14, resize: "vertical", fontFamily: "inherit",
              boxSizing: "border-box", outline: "none",
            }} />
          ) : (
            <div style={{ padding: 14, color: "#cbd5e1", fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
              {lesson.content || <span style={{ color: "#4b5563" }}>Конспект пустой — нажми «Изменить», вставь текст или загрузи файл.</span>}
            </div>
          )}
        </div>
      </div>

      {/* AI buttons */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        padding: "10px 14px 16px", background: "#0c0c18",
        borderTop: "1px solid #1e1e2e", display: "flex", gap: 8,
        maxWidth: 480, margin: "0 auto",
      }}>
        {[
          { mode: "summary", emoji: "📋", label: "Выжимка" },
          { mode: "quiz", emoji: "🧠", label: "Проверка" },
          { mode: "chat", emoji: "💬", label: "Спросить AI" },
        ].map((btn) => (
          <button key={btn.mode} onClick={() => onOpenAI(btn.mode)} style={{
            flex: 1, padding: "11px 6px",
            background: "#1e1e35", border: "1px solid #3b3b52",
            borderRadius: 10, color: "#c084fc",
            cursor: "pointer", fontSize: 12, fontWeight: 700,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          }}>
            <span style={{ fontSize: 18 }}>{btn.emoji}</span>
            <span>{btn.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MODULES SCREEN
// ============================================================
function ModulesScreen({ modules, onSelectLesson, onAddModule, onAddLesson }) {
  const [expanded, setExpanded] = useState(() => modules.map((m) => m.id));
  const toggle = (id) =>
    setExpanded((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const allReviewDue = modules.flatMap((m) =>
    m.lessons.filter(needsReview).map((l) => ({ ...l, moduleName: m.title, moduleId: m.id }))
  );

  return (
    <div style={{ padding: "12px 0 100px" }}>
      {/* Review banner */}
      {allReviewDue.length > 0 && (
        <div style={{
          margin: "0 14px 12px",
          background: "#1a1000", border: "1px solid #f59e0b",
          borderRadius: 12, padding: "12px 14px",
        }}>
          <div style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            🔔 Пора повторить ({allReviewDue.length} урок{allReviewDue.length > 1 ? "а" : ""})
          </div>
          {allReviewDue.map((l) => (
            <div key={l.id} onClick={() => onSelectLesson(l.moduleId, l.id)}
              style={{ color: "#92400e", fontSize: 12, padding: "2px 0", cursor: "pointer" }}>
              → {l.title}
            </div>
          ))}
        </div>
      )}

      {modules.map((mod) => {
        const total = mod.lessons.length;
        const done = mod.lessons.filter((l) => l.mastery >= 3).length;
        const isOpen = expanded.includes(mod.id);
        const reviewCount = mod.lessons.filter(needsReview).length;
        return (
          <div key={mod.id} style={{ marginBottom: 4 }}>
            <div onClick={() => toggle(mod.id)} style={{
              padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
              cursor: "pointer", userSelect: "none",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "#1e1e35", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, flexShrink: 0,
              }}>📦</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontWeight: 700, color: "#c084fc", fontSize: 14 }}>{mod.title}</div>
                  {reviewCount > 0 && (
                    <span style={{
                      background: "#f59e0b", color: "#000",
                      fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 10,
                    }}>{reviewCount}</span>
                  )}
                </div>
                <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>{total} уроков · {done} усвоено</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ color: "#6b7280", fontSize: 16 }}>{isOpen ? "▾" : "▸"}</span>
                <div style={{ width: 48 }}><ProgressBar value={done} max={total} /></div>
              </div>
            </div>

            {isOpen && (
              <div style={{ paddingLeft: 16 }}>
                {mod.lessons.map((lesson) => (
                  <div key={lesson.id} onClick={() => onSelectLesson(mod.id, lesson.id)}
                    style={{
                      padding: "12px 14px", background: "#0f0f1a",
                      borderRadius: 10, marginBottom: 6, marginRight: 16,
                      display: "flex", alignItems: "center", gap: 10,
                      cursor: "pointer",
                      borderLeft: "3px solid " + (needsReview(lesson) ? "#f59e0b" : MASTERY_COLORS[lesson.mastery]),
                    }}>
                    <div style={{ fontSize: 18 }}>{lesson.completed ? "✅" : "⬜"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{lesson.title}</div>
                      <div style={{ marginTop: 5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <MasteryBadge level={lesson.mastery} />
                        {needsReview(lesson) && (
                          <span style={{ color: "#f59e0b", fontSize: 11, fontWeight: 600 }}>🔔 повторить</span>
                        )}
                      </div>
                    </div>
                    <div style={{ color: "#4b5563", fontSize: 18 }}>›</div>
                  </div>
                ))}
                <div onClick={() => onAddLesson(mod.id)} style={{
                  padding: "10px 14px", marginRight: 16, marginBottom: 8,
                  border: "1px dashed #2d2d42", borderRadius: 10,
                  color: "#4b5563", fontSize: 13, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ fontSize: 16 }}>＋</span> Добавить урок
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ padding: "8px 16px" }}>
        <button onClick={onAddModule} style={{
          width: "100%", padding: "14px",
          background: "#1e1e35", border: "1px dashed #3b3b52",
          borderRadius: 12, color: "#a78bfa",
          cursor: "pointer", fontSize: 14, fontWeight: 700,
        }}>＋ Новый модуль</button>
      </div>
    </div>
  );
}

// ============================================================
// AI CHAT SCREEN
// ============================================================
function AIChatScreen({ modules, activeLesson, mode, onClose, onQuizComplete }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [quizScore, setQuizScore] = useState(null);
  const [questionCount, setQuestionCount] = useState(0);
  const bottomRef = useRef(null);

  const focusLesson = activeLesson
    ? modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleName: m.title }))).find((l) => l.id === activeLesson.lessonId)
    : null;

  const getSystem = () => {
    const kb = buildKnowledgeBase(modules);
    const fx = focusLesson
      ? `\n\nАКТИВНЫЙ УРОК: "${focusLesson.title}" (${focusLesson.moduleName})\n${focusLesson.content}`
      : "";
    if (mode === "quiz") return `Ты — строгий наставник по маркетингу. Проверяй усвоение.
БАЗА ЗНАНИЙ:\n${kb}${fx}
ПРАВИЛА:
- Задавай ОДИН вопрос за раз
- После ответа: оценка (✅/⚠️/❌) + что упущено + следующий вопрос
- После 5 вопросов: подведи итог, укажи слабые места, напиши "ИТОГОВЫЙ БАЛЛ: X/10"
- Отвечай только по базе знаний. Язык: русский, кратко.`;
    return `Ты — AI-наставник по маркетингу. Отвечаешь ТОЛЬКО по базе знаний пользователя.
БАЗА ЗНАНИЙ:\n${kb}${fx}
ПРАВИЛА: вне базы — скажи что не изучено. Выжимки: по пунктам. Указывай источник. Язык: русский, кратко.`;
  };

  const modeConfig = {
    chat: { title: "💬 Вопрос-ответ", placeholder: "Задай вопрос...", initMsg: "Привет! Задавай вопросы по пройденным материалам." },
    quiz: { title: "🧠 Проверка знаний", placeholder: "Введи ответ...", initMsg: null },
    summary: { title: "📋 Выжимка", placeholder: "Уточни запрос...", initMsg: null },
  };
  const cfg = modeConfig[mode];

  useEffect(() => {
    const init = async () => {
      if (mode === "chat") { setMessages([{ role: "assistant", content: cfg.initMsg }]); return; }
      setLoading(true);
      const prompt = mode === "quiz"
        ? "Начни проверку. Задай первый вопрос по материалу."
        : focusLesson
          ? `Структурированная выжимка урока "${focusLesson.title}": ключевые идеи (5-7 пунктов), термины, практическое применение.`
          : "Обзор всех пройденных материалов: модули, ключевые концепции, связи между темами.";
      const reply = await callClaude([{ role: "user", content: prompt }], getSystem());
      setMessages([{ role: "assistant", content: reply }]);
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // Parse score from quiz response
  const parseScore = (text) => {
    const match = text.match(/ИТОГОВЫЙ БАЛЛ:\s*(\d+)\/10/);
    return match ? parseInt(match[1]) : null;
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    const reply = await callClaude(next, getSystem());
    const newMessages = [...next, { role: "assistant", content: reply }];
    setMessages(newMessages);

    if (mode === "quiz") {
      const newCount = questionCount + 1;
      setQuestionCount(newCount);
      const score = parseScore(reply);
      if (score !== null) {
        setQuizScore(score);
        if (onQuizComplete && focusLesson) {
          onQuizComplete({ lessonId: focusLesson.id, score, date: new Date().toISOString() });
        }
      }
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "#0c0c18" }}>
      <BackHeader
        title={cfg.title}
        subtitle={focusLesson ? `Фокус: ${focusLesson.title}` : "Все материалы"}
        onBack={onClose}
        right={mode === "quiz" && questionCount > 0 ? (
          <span style={{ fontSize: 12, color: "#6b7280" }}>Вопрос {Math.min(questionCount, 5)}/5</span>
        ) : null}
      />

      {/* Quiz score banner */}
      {quizScore !== null && (
        <div style={{
          background: quizScore >= 7 ? "#0f2f0f" : "#2d1000",
          border: "1px solid " + (quizScore >= 7 ? "#10b981" : "#f59e0b"),
          padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 24 }}>{quizScore >= 8 ? "🏆" : quizScore >= 6 ? "👍" : "📚"}</span>
          <div>
            <div style={{ fontWeight: 700, color: quizScore >= 7 ? "#10b981" : "#f59e0b", fontSize: 14 }}>
              Результат: {quizScore}/10
            </div>
            <div style={{ color: "#6b7280", fontSize: 12 }}>Результат сохранён в историю</div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "88%",
            background: m.role === "user" ? "#4c1d95" : "#1a1a2e",
            borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            padding: "12px 14px", color: "#e2e8f0",
            fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap",
          }}>{m.content}</div>
        ))}
        {loading && (
          <div style={{
            alignSelf: "flex-start", background: "#1a1a2e",
            borderRadius: "16px 16px 16px 4px", padding: "12px 16px",
            color: "#6b7280", fontSize: 14,
          }}>⏳ Думаю...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        padding: "10px 14px 20px", borderTop: "1px solid #1e1e2e",
        background: "#0f0f1a", display: "flex", gap: 8, flexShrink: 0,
      }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={cfg.placeholder}
          style={{
            flex: 1, background: "#13131f", border: "1px solid #2d2d42",
            borderRadius: 12, color: "#e2e8f0", fontSize: 14,
            padding: "12px 14px", outline: "none",
          }} />
        <button onClick={send} disabled={loading} style={{
          background: "#7c3aed", border: "none", borderRadius: 12,
          color: "#fff", fontSize: 20, width: 48, height: 48,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.6 : 1, flexShrink: 0,
        }}>→</button>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD SCREEN
// ============================================================
function DashboardScreen({ modules, quizHistory }) {
  const all = modules.flatMap((m) => m.lessons);
  const completed = all.filter((l) => l.completed).length;
  const mastered = all.filter((l) => l.mastery >= 3).length;
  const avg = all.length ? all.reduce((s, l) => s + l.mastery, 0) / all.length : 0;
  const reviewDue = all.filter(needsReview).length;

  // Quiz history last 5
  const recent = [...quizHistory].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  // Weak lessons: quiz score < 6
  const weakLessonIds = new Set(quizHistory.filter((q) => q.score < 6).map((q) => q.lessonId));
  const weakLessons = modules.flatMap((m) =>
    m.lessons.filter((l) => weakLessonIds.has(l.id)).map((l) => ({ ...l, moduleName: m.title }))
  );

  return (
    <div style={{ padding: "16px 14px 100px" }}>
      <div style={{ fontWeight: 800, fontSize: 18, color: "#e2e8f0", marginBottom: 16 }}>📊 Прогресс</div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Просмотрено", value: `${completed}/${all.length}`, color: "#3b82f6", emoji: "📖" },
          { label: "Усвоено", value: `${mastered}/${all.length}`, color: "#10b981", emoji: "✅" },
          { label: "Средний уровень", value: `${avg.toFixed(1)}/4`, color: "#a78bfa", emoji: "📈" },
          { label: "Пора повторить", value: reviewDue, color: reviewDue > 0 ? "#f59e0b" : "#3a3a4a", emoji: "🔔" },
        ].map((s) => (
          <div key={s.label} style={{
            background: "#0f0f1a", border: "1px solid #1e1e2e",
            borderRadius: 12, padding: "14px 14px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>{s.emoji}</span>
              <div style={{ color: s.color, fontSize: 22, fontWeight: 800 }}>{s.value}</div>
            </div>
            <div style={{ color: "#6b7280", fontSize: 11 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Weak spots */}
      {weakLessons.length > 0 && (
        <div style={{ background: "#1a0f0f", border: "1px solid #7f1d1d", borderRadius: 12, padding: "14px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#ef4444", fontSize: 13, marginBottom: 8 }}>⚠️ Слабые места</div>
          {weakLessons.map((l) => (
            <div key={l.id} style={{ color: "#94a3b8", fontSize: 13, padding: "3px 0", display: "flex", gap: 6 }}>
              <span style={{ color: "#7f1d1d" }}>→</span>
              <span>{l.title}</span>
              <span style={{ color: "#4b5563", fontSize: 11 }}>({l.moduleName})</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent quizzes */}
      {recent.length > 0 && (
        <div style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 12, padding: "14px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: "#c084fc", fontSize: 13, marginBottom: 10 }}>🧠 История проверок</div>
          {recent.map((q, i) => {
            const lesson = modules.flatMap((m) => m.lessons).find((l) => l.id === q.lessonId);
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 0", borderBottom: i < recent.length - 1 ? "1px solid #1e1e2e" : "none",
              }}>
                <span style={{ fontSize: 16 }}>{q.score >= 8 ? "🏆" : q.score >= 6 ? "👍" : "📚"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#e2e8f0", fontSize: 13 }}>{lesson?.title || "Урок"}</div>
                  <div style={{ color: "#6b7280", fontSize: 11 }}>{new Date(q.date).toLocaleDateString("ru-RU")}</div>
                </div>
                <span style={{
                  fontWeight: 800, fontSize: 14,
                  color: q.score >= 7 ? "#10b981" : q.score >= 5 ? "#f59e0b" : "#ef4444",
                }}>{q.score}/10</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Modules */}
      {modules.map((mod) => {
        const total = mod.lessons.length;
        const done = mod.lessons.filter((l) => l.mastery >= 3).length;
        return (
          <div key={mod.id} style={{
            background: "#0f0f1a", border: "1px solid #1e1e2e",
            borderRadius: 12, padding: "14px", marginBottom: 10,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, color: "#c084fc", fontSize: 14 }}>{mod.title}</div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>{done}/{total}</div>
            </div>
            <ProgressBar value={done} max={total} color="#8b5cf6" />
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {mod.lessons.map((l) => {
                const daysLeft = getDaysUntilReview(l);
                return (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: l.completed ? "#10b981" : "#4b5563" }}>{l.completed ? "✓" : "○"}</span>
                    <span style={{ flex: 1, fontSize: 12, color: "#94a3b8" }}>{l.title.replace(/^Урок \d+: /, "")}</span>
                    {needsReview(l)
                      ? <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700 }}>🔔</span>
                      : l.lastReviewed && daysLeft > 0
                        ? <span style={{ fontSize: 10, color: "#4b5563" }}>{daysLeft}д</span>
                        : null
                    }
                    <MasteryBadge level={l.mastery} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// BOTTOM NAV
// ============================================================
function BottomNav({ active, onChange }) {
  const tabs = [
    { id: "modules", emoji: "📚", label: "Уроки" },
    { id: "dashboard", emoji: "📊", label: "Прогресс" },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "#0f0f1a", borderTop: "1px solid #1e1e2e",
      display: "flex", height: 58, zIndex: 50, maxWidth: 480, margin: "0 auto",
    }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          flex: 1, background: "none", border: "none",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 2, cursor: "pointer",
          color: active === t.id ? "#a78bfa" : "#4b5563",
        }}>
          <span style={{ fontSize: 20 }}>{t.emoji}</span>
          <span style={{ fontSize: 10, fontWeight: 600 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function MarketingOS() {
  const [modules, setModules] = useState(INITIAL_MODULES);
  const [quizHistory, setQuizHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [tab, setTab] = useState("modules");
  const [activeLesson, setActiveLesson] = useState(null);
  const [aiMode, setAiMode] = useState(null);
  const [showAddModule, setShowAddModule] = useState(false);
  const [showAddLesson, setShowAddLesson] = useState(null);
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [newLessonTitle, setNewLessonTitle] = useState("");

  useEffect(() => {
    Promise.all([loadModules(), loadQuizHistory()]).then(([mods, hist]) => {
      if (mods) setModules(mods);
      if (hist) setQuizHistory(hist);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaveStatus("saving");
    const t = setTimeout(async () => {
      await saveModules(modules);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 1800);
    }, 700);
    return () => clearTimeout(t);
  }, [modules, loaded]);

  const selectLesson = (moduleId, lessonId) => setActiveLesson({ moduleId, lessonId });

  const updateLesson = (moduleId, lessonId, updated) =>
    setModules((prev) =>
      prev.map((m) =>
        m.id !== moduleId ? m : { ...m, lessons: m.lessons.map((l) => (l.id === lessonId ? updated : l)) }
      )
    );

  const addModule = () => {
    if (!newModuleTitle.trim()) return;
    setModules((prev) => [...prev, { id: "m" + Date.now(), title: newModuleTitle.trim(), lessons: [] }]);
    setNewModuleTitle(""); setShowAddModule(false);
  };

  const addLesson = (moduleId) => {
    if (!newLessonTitle.trim()) return;
    const id = "l" + Date.now();
    setModules((prev) => prev.map((m) => m.id !== moduleId ? m : {
      ...m, lessons: [...m.lessons, { id, title: newLessonTitle.trim(), content: "", mastery: 0, completed: false, lastReviewed: null }]
    }));
    setNewLessonTitle(""); setShowAddLesson(null);
    selectLesson(moduleId, id);
  };

  const handleQuizComplete = async (result) => {
    const newHistory = [...quizHistory, result];
    setQuizHistory(newHistory);
    await saveQuizHistory(newHistory);
  };

  const currentModule = modules.find((m) => m.id === activeLesson?.moduleId);
  const currentLesson = currentModule?.lessons.find((l) => l.id === activeLesson?.lessonId);

  return (
    <div style={{
      fontFamily: "'Inter', -apple-system, sans-serif",
      background: "#13131f", color: "#e2e8f0",
      minHeight: "100vh", maxWidth: 480, margin: "0 auto",
      position: "relative",
    }}>
      {!loaded && (
        <div style={{
          position: "fixed", inset: 0, background: "#0c0c18",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          zIndex: 999, gap: 12,
        }}>
          <div style={{ fontSize: 40 }}>📚</div>
          <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 17 }}>МАРКЕТИНГ OS</div>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Загружаю данные...</div>
        </div>
      )}

      {/* Header */}
      <div style={{
        padding: "14px 16px 10px", background: "#0f0f1a",
        borderBottom: "1px solid #1e1e2e", position: "sticky", top: 0, zIndex: 20,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#c084fc", letterSpacing: 1 }}>📚 МАРКЕТИНГ OS</div>
          <div style={{ color: "#6b7280", fontSize: 11 }}>Личная база знаний</div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 600, transition: "opacity 0.3s",
          opacity: saveStatus ? 1 : 0,
          color: saveStatus === "saved" ? "#10b981" : "#f59e0b",
        }}>
          {saveStatus === "saving" ? "⏳ Сохраняю..." : "✅ Сохранено"}
        </div>
      </div>

      {/* Content */}
      <div style={{ paddingBottom: 58 }}>
        {tab === "modules" && (
          <ModulesScreen modules={modules} onSelectLesson={selectLesson}
            onAddModule={() => setShowAddModule(true)}
            onAddLesson={(modId) => setShowAddLesson(modId)} />
        )}
        {tab === "dashboard" && <DashboardScreen modules={modules} quizHistory={quizHistory} />}
      </div>

      {/* Lesson sheet */}
      <Sheet visible={!!activeLesson && !aiMode} onClose={() => setActiveLesson(null)}>
        {currentLesson && currentModule && (
          <LessonScreen
            module={currentModule} lesson={currentLesson}
            onUpdateLesson={(updated) => updateLesson(currentModule.id, currentLesson.id, updated)}
            onBack={() => setActiveLesson(null)}
            onOpenAI={(mode) => setAiMode(mode)}
          />
        )}
      </Sheet>

      {/* AI sheet */}
      <Sheet visible={!!aiMode} onClose={() => setAiMode(null)}>
        {aiMode && (
          <AIChatScreen
            modules={modules} activeLesson={activeLesson}
            mode={aiMode} onClose={() => setAiMode(null)}
            onQuizComplete={handleQuizComplete}
          />
        )}
      </Sheet>

      {!activeLesson && !aiMode && <BottomNav active={tab} onChange={setTab} />}

      {showAddModule && (
        <Modal title="Новый модуль" onClose={() => setShowAddModule(false)}>
          <input autoFocus value={newModuleTitle} onChange={(e) => setNewModuleTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addModule()}
            placeholder="Название модуля"
            style={{
              width: "100%", background: "#0f0f1a", border: "1px solid #2d2d42",
              borderRadius: 10, color: "#e2e8f0", padding: "13px 14px",
              fontSize: 15, marginBottom: 12, boxSizing: "border-box",
            }} />
          <button onClick={addModule} style={{
            width: "100%", padding: 14, background: "#7c3aed", border: "none",
            borderRadius: 10, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 15,
          }}>Создать модуль</button>
        </Modal>
      )}

      {showAddLesson && (
        <Modal title="Новый урок" onClose={() => setShowAddLesson(null)}>
          <input autoFocus value={newLessonTitle} onChange={(e) => setNewLessonTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLesson(showAddLesson)}
            placeholder="Урок 2: Название"
            style={{
              width: "100%", background: "#0f0f1a", border: "1px solid #2d2d42",
              borderRadius: 10, color: "#e2e8f0", padding: "13px 14px",
              fontSize: 15, marginBottom: 12, boxSizing: "border-box",
            }} />
          <button onClick={() => addLesson(showAddLesson)} style={{
            width: "100%", padding: 14, background: "#7c3aed", border: "none",
            borderRadius: 10, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 15,
          }}>Добавить урок</button>
        </Modal>
      )}
    </div>
  );
}
