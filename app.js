import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// ── Supabase config (anon key is safe to expose — read-only via RLS) ─────────
const SUPABASE_URL      = 'REPLACE_WITH_YOUR_SUPABASE_URL'
const SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let ALL_QUESTIONS = []

function mapQuestion(row) {
  return {
    id:              row.id,
    category:        row.category,
    difficulty:      row.difficulty,
    question:        row.question,
    answer:          row.answer,
    answerType:      row.answer_type,
    acceptedAnswers: row.accepted_answers ?? [],
    timeLimit:       row.time_limit,
  }
}

async function loadQuestions() {
  const { data, error } = await supabase.from('questions').select('*')
  if (error) { console.error('Failed to load questions:', error.message); return }
  ALL_QUESTIONS = data.map(mapQuestion)
  $btnStart.disabled = false
}

// ── Constants ────────────────────────────────────────────────────────────────
const RING_C = 339.29; // 2 * PI * 54
const FEEDBACK_DURATION = 1600; // ms
const SCORE_MESSAGES = [
  { min: 0,  max: 4,  text: "T'as dormi pendant les cours ? 😴" },
  { min: 5,  max: 9,  text: "Pas mal pour un apéro ! 🍻" },
  { min: 10, max: 14, text: "T'as quelques neurones qui tiennent ! 🧠" },
  { min: 15, max: 17, text: "Impressionnant ! Roi du zinc ! 👑" },
  { min: 18, max: 20, text: "ENCYCLOPÉDIE VIVANTE. Respect. 🤯" },
];
const CAT_LABELS = {
  histoire:    "Histoire",
  geographie:  "Géographie",
  sport:       "Sport",
  cinema:      "Cinéma",
  litterature: "Littérature",
  art:         "Art",
  politique:   "Politique",
  bd_manga:    "BD & Manga",
};
const DIFF_LABELS = { easy: "Facile", medium: "Moyen", hard: "Difficile" };

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  screen: "landing",
  questions: [],
  currentIndex: 0,
  answers: [],
  score: 0,
  timer: null,
};

// ── Utils ────────────────────────────────────────────────────────────────────
function normalize(str) {
  return str
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(le |la |les |l'|l`|un |une |des |the )/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = [];
  for (let i = 0; i <= m; i++) { dp[i] = [i]; }
  for (let j = 0; j <= n; j++) { dp[0][j] = j; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function tolerance(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  if (len <= 10) return 2;
  return 3;
}

function fuzzyMatch(input, candidate) {
  const ni = normalize(input);
  const nc = normalize(candidate);
  if (ni === nc) return true;
  const t = tolerance(Math.max(ni.length, nc.length));
  return levenshtein(ni, nc) <= t;
}

function nameMatch(input, candidate) {
  const tokens = normalize(candidate).split(" ").filter(Boolean);
  const inputTokens = normalize(input).split(" ").filter(Boolean);
  // Last name is the last token of the canonical answer
  const lastName = tokens[tokens.length - 1];
  // Check if any input token fuzzy-matches the last name
  for (const it of inputTokens) {
    const t = tolerance(Math.max(it.length, lastName.length));
    if (levenshtein(it, lastName) <= t) return true;
  }
  // Also allow full name match
  const ni = normalize(input);
  const nc = normalize(candidate);
  const t = tolerance(Math.max(ni.length, nc.length));
  return levenshtein(ni, nc) <= t;
}

const MONTH_MAP = {
  janvier:1, fevrier:2, mars:3, avril:4, mai:5, juin:6,
  juillet:7, aout:8, septembre:9, octobre:10, novembre:11, decembre:12,
};

function parseDate(str) {
  const s = normalize(str).replace(/[.,]/g, "");
  // year only
  const yOnly = s.match(/^(\d{4})$/);
  if (yOnly) return { day: null, month: null, year: +yOnly[1] };
  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return { day: +dmy[1], month: +dmy[2], year: +dmy[3] };
  // yyyy-mm-dd
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) return { day: +ymd[3], month: +ymd[2], year: +ymd[1] };
  // "14 juillet 1789" or "juillet 1789"
  const textDate = s.match(/^(\d{1,2})?\s*([a-z]+)\s+(\d{4})$/);
  if (textDate) {
    const monthNum = MONTH_MAP[textDate[2]];
    if (monthNum) return {
      day: textDate[1] ? +textDate[1] : null,
      month: monthNum,
      year: +textDate[3],
    };
  }
  return null;
}

function dateMatch(input, canonical) {
  const pi = parseDate(input);
  const pc = parseDate(canonical);
  if (!pi || !pc) return false;
  if (pc.year !== null && pi.year !== null && pc.year !== pi.year) return false;
  if (pc.month !== null && pi.month !== null && pc.month !== pi.month) return false;
  if (pc.day !== null && pi.day !== null && pc.day !== pi.day) return false;
  return true;
}

function checkAnswer(question, userInput) {
  if (!userInput.trim()) return false;
  const candidates = [question.answer, ...(question.acceptedAnswers || [])];
  if (question.answerType === "date") {
    return candidates.some(c => dateMatch(userInput, c));
  }
  if (question.answerType === "name") {
    return candidates.some(c => nameMatch(userInput, c));
  }
  // text
  return candidates.some(c => fuzzyMatch(userInput, c));
}

// ── Question sampling ────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawQuestions() {
  const easy   = shuffle(ALL_QUESTIONS.filter(q => q.difficulty === "easy"));
  const medium = shuffle(ALL_QUESTIONS.filter(q => q.difficulty === "medium"));
  const hard   = shuffle(ALL_QUESTIONS.filter(q => q.difficulty === "hard"));
  return shuffle([
    ...easy.slice(0, 7),
    ...medium.slice(0, 9),
    ...hard.slice(0, 4),
  ]);
}

// ── Timer ────────────────────────────────────────────────────────────────────
class QuestionTimer {
  constructor(durationSec, onTick, onExpire) {
    this.duration = durationSec;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this._id = null;
  }
  start() {
    const end = Date.now() + this.duration * 1000;
    this._id = setInterval(() => {
      const rem = Math.max(0, (end - Date.now()) / 1000);
      this.onTick(rem, rem / this.duration);
      if (rem <= 0) { this.stop(); this.onExpire(); }
    }, 100);
  }
  stop() { clearInterval(this._id); }
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const screens = {
  landing: document.getElementById("screen-landing"),
  playing: document.getElementById("screen-playing"),
  results: document.getElementById("screen-results"),
};
const $badgeCat    = document.getElementById("badge-category");
const $badgeDiff   = document.getElementById("badge-difficulty");
const $counter     = document.getElementById("question-counter");
const $score       = document.getElementById("current-score");
const $timerRing   = document.getElementById("timer-ring");
const $timerLabel  = document.getElementById("timer-label");
const $questionTxt = document.getElementById("question-text");
const $answerInput = document.getElementById("answer-input");
const $btnValidate = document.getElementById("btn-validate");
const $feedback    = document.getElementById("feedback-overlay");
const $fbIcon      = document.getElementById("feedback-icon");
const $fbMsg       = document.getElementById("feedback-message");
const $fbAnswer    = document.getElementById("feedback-answer");
const $finalScore  = document.getElementById("final-score");
const $scoreMsg    = document.getElementById("score-message");
const $recapList   = document.getElementById("recap-list");
const $btnStart    = document.getElementById("btn-start");
const $btnReplay   = document.getElementById("btn-replay");

// ── Screen transitions ───────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle("active", k === name);
  });
  state.screen = name;
}

// ── Timer rendering ──────────────────────────────────────────────────────────
function renderTimer(remaining, fraction) {
  $timerLabel.textContent = Math.ceil(remaining);
  $timerRing.style.strokeDashoffset = RING_C * (1 - fraction);
  $timerRing.classList.remove("warn", "danger");
  if (fraction <= 0.25) $timerRing.classList.add("danger");
  else if (fraction <= 0.5) $timerRing.classList.add("warn");
}

// ── Show feedback then advance ────────────────────────────────────────────────
function showFeedback(correct, question, userInput) {
  $feedback.classList.remove("hidden", "correct", "wrong");
  if (correct) {
    $feedback.classList.add("correct");
    $fbIcon.textContent = "✓";
    $fbMsg.textContent = "Bonne réponse !";
    $fbMsg.style.color = "var(--success)";
    $fbAnswer.textContent = "";
  } else {
    $feedback.classList.add("wrong");
    $fbIcon.textContent = "✗";
    $fbMsg.textContent = userInput ? "Pas tout à fait…" : "Temps écoulé !";
    $fbMsg.style.color = "var(--error)";
    $fbAnswer.textContent = `Réponse : ${question.answer}`;
  }
  setTimeout(() => {
    $feedback.classList.add("hidden");
    advanceQuestion();
  }, FEEDBACK_DURATION);
}

// ── Load a question ──────────────────────────────────────────────────────────
function loadQuestion(index) {
  const q = state.questions[index];
  $counter.textContent = `Q ${index + 1} / 20`;
  $score.textContent = `${state.score} pt${state.score !== 1 ? "s" : ""}`;

  $badgeCat.textContent = CAT_LABELS[q.category] || q.category;
  $badgeCat.dataset.cat = q.category;
  $badgeDiff.textContent = DIFF_LABELS[q.difficulty] || q.difficulty;

  $questionTxt.textContent = q.question;
  $answerInput.value = "";
  $answerInput.disabled = false;
  $btnValidate.disabled = false;
  setTimeout(() => $answerInput.focus(), 50);

  renderTimer(q.timeLimit, 1);

  if (state.timer) state.timer.stop();
  state.timer = new QuestionTimer(
    q.timeLimit,
    renderTimer,
    () => handleSubmit(true)
  );
  state.timer.start();
}

// ── Submit answer ────────────────────────────────────────────────────────────
function handleSubmit(expired = false) {
  if (state.timer) state.timer.stop();
  $answerInput.disabled = true;
  $btnValidate.disabled = true;

  const q = state.questions[state.currentIndex];
  const userInput = expired ? "" : $answerInput.value;
  const correct = !expired && checkAnswer(q, userInput);

  if (correct) state.score++;

  state.answers.push({
    question: q,
    userAnswer: userInput,
    correct,
  });

  showFeedback(correct, q, userInput);
}

// ── Advance to next question or results ──────────────────────────────────────
function advanceQuestion() {
  state.currentIndex++;
  if (state.currentIndex >= 20) {
    showResults();
  } else {
    loadQuestion(state.currentIndex);
  }
}

// ── Start game ───────────────────────────────────────────────────────────────
function startGame() {
  state.questions = drawQuestions();
  state.currentIndex = 0;
  state.answers = [];
  state.score = 0;
  showScreen("playing");
  loadQuestion(0);
}

// ── Results ──────────────────────────────────────────────────────────────────
function showResults() {
  if (state.timer) state.timer.stop();
  showScreen("results");

  $finalScore.textContent = state.score;
  const msg = SCORE_MESSAGES.find(m => state.score >= m.min && state.score <= m.max);
  $scoreMsg.textContent = msg ? msg.text : "";

  // Recap
  $recapList.innerHTML = "";
  state.answers.forEach((a, i) => {
    const item = document.createElement("div");
    item.className = `recap-item ${a.correct ? "correct" : "wrong"}`;
    const indicator = a.correct ? "✓" : "✗";
    const userDisplay = a.userAnswer || "(pas de réponse)";
    const wrongHint = !a.correct
      ? `<div class="recap-correct-answer">Réponse : <strong>${a.question.answer}</strong></div>`
      : "";
    item.innerHTML = `
      <div class="recap-indicator">${indicator}</div>
      <div>
        <div class="recap-q">Q${i + 1}. ${a.question.question}</div>
        <div class="recap-user-answer">${userDisplay}</div>
        ${wrongHint}
      </div>`;
    $recapList.appendChild(item);
  });

  launchConfetti();
}

// ── Confetti ─────────────────────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ["#e94560","#f5a623","#4ade80","#3b82f6","#ec4899","#8b5cf6"];
  const pieces = Array.from({ length: 80 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height,
    w: 8 + Math.random() * 8,
    h: 6 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 2,
    vy: 2 + Math.random() * 3,
    angle: Math.random() * Math.PI * 2,
    va: (Math.random() - 0.5) * 0.15,
  }));

  let frame;
  const startTime = Date.now();
  function draw() {
    if (Date.now() - startTime > 4000) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.angle += p.va;
      if (p.y > canvas.height) { p.y = -20; p.x = Math.random() * canvas.width; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame = requestAnimationFrame(draw);
  }
  cancelAnimationFrame(frame);
  draw();
}

// ── Events ───────────────────────────────────────────────────────────────────
$btnStart.disabled = true  // re-enabled once questions are fetched
loadQuestions()

$btnStart.addEventListener("click", startGame);
$btnReplay.addEventListener("click", () => { showScreen("landing"); });
$btnValidate.addEventListener("click", () => handleSubmit(false));
$answerInput.addEventListener("keydown", e => {
  if (e.key === "Enter") handleSubmit(false);
});
