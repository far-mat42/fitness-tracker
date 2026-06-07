// ─── Constants ───────────────────────────────────────────────────────────────
const WORKER_URL_KEY = "fitness_tracker_worker_url";
const AUTH_TOKEN_KEY = "fitness_tracker_auth_token";
const MIN_DATE       = "2026-06-01"; // earliest selectable date

// ─── State ───────────────────────────────────────────────────────────────────
let workerUrl;
let authToken;
let currentMonth;
let selectedDate;
let activeView    = "nutrition"; // calendar heatmap layer
let topView       = "calendar";  // "calendar" | "trends"
let trendDays     = 30;
let exerciseLibrary = [];        // [{id, name, category}] — refreshed on change

const els = {};

// ─── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  setInitialDates();
  bindEvents();

  workerUrl = localStorage.getItem(WORKER_URL_KEY) || "";
  authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";

  if (!workerUrl || !authToken) {
    showConfigModal();
    return;
  }
  await initApp();
});

async function initApp() {
  setStatus("Connecting…", true);
  try {
    await dbQuery("SELECT 1");
    setStatus("Connected");
    await Promise.all([populateExerciseLibSelect(), refreshRecipeModal()]);
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Connection failed — check settings", true);
  }
}

// ─── Config modal ─────────────────────────────────────────────────────────────
function showConfigModal() {
  document.getElementById("configModal")?.remove();
  const modal = document.createElement("dialog");
  modal.id = "configModal";
  modal.innerHTML = `
    <form id="configForm">
      <h2>Connect to your Worker</h2>
      <p>Your Cloudflare Worker URL and auth token are saved in this browser only.</p>
      <label>Worker URL
        <input id="configWorkerUrl" type="url" placeholder="https://fitness-tracker-api.xxx.workers.dev"
          value="${escapeHtml(workerUrl)}" required />
      </label>
      <label>Auth Token
        <input id="configAuthToken" type="password" placeholder="your-secret-token"
          value="${escapeHtml(authToken)}" required />
      </label>
      <p id="configError" style="color:#f85149;display:none"></p>
      <div class="config-actions">
        <button type="submit" id="configSubmitBtn">Connect</button>
        ${workerUrl ? `<button type="button" id="configCancelBtn" class="secondary">Cancel</button>` : ""}
      </div>
    </form>`;
  document.body.appendChild(modal);
  modal.showModal();

  modal.querySelector("#configCancelBtn")?.addEventListener("click", () => {
    modal.close(); modal.remove();
  });

  modal.querySelector("#configForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newUrl   = modal.querySelector("#configWorkerUrl").value.trim().replace(/\/$/, "");
    const newToken = modal.querySelector("#configAuthToken").value.trim();
    const errEl    = modal.querySelector("#configError");
    const submitBtn = modal.querySelector("#configSubmitBtn");
    errEl.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Connecting…";
    try {
      const res = await fetch(`${newUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${newToken}` },
        body: JSON.stringify({ sql: "SELECT 1" })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      workerUrl = newUrl;
      authToken = newToken;
      localStorage.setItem(WORKER_URL_KEY, workerUrl);
      localStorage.setItem(AUTH_TOKEN_KEY, authToken);
      modal.close(); modal.remove();
      await initApp();
    } catch (err) {
      errEl.textContent = `Could not connect: ${err.message}`;
      errEl.style.display = "";
      submitBtn.disabled = false;
      submitBtn.textContent = "Connect";
    }
  });
}

// ─── Worker API layer ─────────────────────────────────────────────────────────
async function dbFetch(path, body) {
  const res = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function dbQuery(sql, params = []) {
  return (await dbFetch("/query", { sql, params })).rows ?? [];
}

async function dbOne(sql, params = []) {
  return (await dbQuery(sql, params))[0] ?? null;
}

async function dbRun(sql, params = []) {
  return dbFetch("/run", { sql, params });
}

async function dbBatch(statements) {
  return dbFetch("/batch", { statements });
}

// ─── Element cache ─────────────────────────────────────────────────────────────
function cacheElements() {
  const ids = [
    "addRecipeBtn", "addExerciseLibBtn", "sampleDataBtn", "settingsBtn",
    "dbStatus",
    "prevMonthBtn", "nextMonthBtn", "todayBtn", "monthLabel", "calendar", "legend",
    "calendarLayout", "trendsLayout", "chartsGrid",
    "exerciseProgressSelect", "exerciseProgressChart", "exerciseProgressCard",
    "selectedDateHeading", "summaryCards",
    "nutritionForm", "mealType", "recipeSelect", "nutritionName", "servings",
    "mealCalories", "mealProtein", "mealFat", "mealCarbs", "nutritionNotes", "nutritionList",
    "sleepForm", "sleepHours", "sleepQuality", "sleepNotes", "sleepList",
    "exerciseForm", "exerciseLibSelect", "exerciseCustomLabel", "exerciseName",
    "exerciseCategory", "exerciseSets", "exerciseReps", "exerciseWeight",
    "exerciseDuration", "exerciseDistance", "exerciseNotes", "exerciseList",
    "bodyForm", "bodyWeight", "bodyWaist", "bodyNotes", "bodyList",
    "recipeModal", "recipeModalClose",
    "recipeForm", "recipeName", "recipeServingSize",
    "recipeCalories", "recipeProtein", "recipeFat", "recipeCarbs", "recipeNotes", "recipeList",
    "exerciseLibModal", "exerciseLibModalClose",
    "exerciseLibForm", "exerciseLibName", "exerciseLibCategory", "exerciseLibNotes", "exerciseLibList"
  ];
  ids.forEach(id => { els[id] = document.getElementById(id); });
  els.viewButtons    = Array.from(document.querySelectorAll(".view-btn"));
  els.tabButtons     = Array.from(document.querySelectorAll(".tab-btn"));
  els.tabSections    = Array.from(document.querySelectorAll(".tab-section"));
  els.topViewButtons = Array.from(document.querySelectorAll(".top-view-btn"));
  els.rangeButtons   = Array.from(document.querySelectorAll(".range-btn"));
}

function setInitialDates() {
  const today    = new Date();
  const todayKey = formatDateKey(today);
  currentMonth   = new Date(today.getFullYear(), today.getMonth(), 1);
  // Clamp selected date to today — it can never be in the future on init
  selectedDate   = todayKey > MIN_DATE ? todayKey : MIN_DATE;
}

// ─── Event binding ─────────────────────────────────────────────────────────────
function bindEvents() {

  // Month navigation
  els.prevMonthBtn.addEventListener("click", async () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    await renderCalendar();
  });
  els.nextMonthBtn.addEventListener("click", async () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    await renderCalendar();
  });
  els.todayBtn.addEventListener("click", async () => {
    const today  = new Date();
    currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDate = formatDateKey(today);
    await renderAll();
  });

  // Calendar heatmap layer
  els.viewButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      activeView = btn.dataset.view;
      els.viewButtons.forEach(b => b.classList.toggle("active", b === btn));
      await renderCalendar();
    });
  });

  // Day tabs
  els.tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      els.tabButtons.forEach(b => b.classList.toggle("active", b === btn));
      els.tabSections.forEach(s => s.classList.toggle("active", s.id === btn.dataset.tab));
    });
  });

  // Calendar day click — only non-disabled cells
  els.calendar.addEventListener("click", async (event) => {
    const day = event.target.closest(".day-cell:not(.empty):not(.disabled)");
    if (!day) return;
    document.querySelectorAll(".day-cell.selected").forEach(el => el.classList.remove("selected"));
    day.classList.add("selected");
    selectedDate = day.dataset.date;
    await renderSelectedDate();
  });

  // Nutrition form
  els.recipeSelect.addEventListener("change", fillMealMacrosFromRecipe);
  els.servings.addEventListener("input", fillMealMacrosFromRecipe);
  els.nutritionForm.addEventListener("submit", handleNutritionSubmit);

  // Sleep form
  els.sleepForm.addEventListener("submit", handleSleepSubmit);

  // Exercise form
  els.exerciseLibSelect.addEventListener("change", handleExerciseLibSelectChange);
  els.exerciseForm.addEventListener("submit", handleExerciseSubmit);

  // Body form
  els.bodyForm.addEventListener("submit", handleBodySubmit);

  // Delete buttons (delegated on body — covers modals too)
  document.body.addEventListener("click", handleDeleteButtons);

  // Top-level view (Calendar / Trends)
  els.topViewButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      topView = btn.dataset.topView;
      els.topViewButtons.forEach(b => b.classList.toggle("active", b === btn));
      await toggleTopView();
    });
  });

  // Trend range
  els.rangeButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      trendDays = Number(btn.dataset.days);
      els.rangeButtons.forEach(b => b.classList.toggle("active", b === btn));
      await renderTrendsView();
    });
  });

  // Exercise progress select
  els.exerciseProgressSelect.addEventListener("change", async () => {
    await renderExerciseProgressChart(els.exerciseProgressSelect.value);
  });

  // Recipe modal
  els.addRecipeBtn.addEventListener("click", async () => {
    await refreshRecipeModal();
    els.recipeModal.showModal();
  });
  els.recipeModalClose.addEventListener("click", () => els.recipeModal.close());
  els.recipeModal.addEventListener("click", e => { if (e.target === els.recipeModal) els.recipeModal.close(); });
  els.recipeForm.addEventListener("submit", handleRecipeSubmit);

  // Exercise library modal
  els.addExerciseLibBtn.addEventListener("click", async () => {
    await refreshExerciseLibModal();
    els.exerciseLibModal.showModal();
  });
  els.exerciseLibModalClose.addEventListener("click", () => els.exerciseLibModal.close());
  els.exerciseLibModal.addEventListener("click", e => { if (e.target === els.exerciseLibModal) els.exerciseLibModal.close(); });
  els.exerciseLibForm.addEventListener("submit", handleExerciseLibSubmit);

  // Misc
  els.sampleDataBtn.addEventListener("click", addSampleData);
  els.settingsBtn.addEventListener("click", () => showConfigModal());
}

// ─── Top-level view switching ─────────────────────────────────────────────────
async function toggleTopView() {
  const isCalendar = topView === "calendar";
  els.calendarLayout.style.display = isCalendar ? "" : "none";
  els.trendsLayout.style.display   = isCalendar ? "none" : "";
  if (!isCalendar) await renderTrendsView();
}

// ─── Render router ─────────────────────────────────────────────────────────────
async function renderAll() {
  if (topView === "calendar") {
    await Promise.all([renderCalendar(), renderSelectedDate()]);
  } else {
    await renderTrendsView();
  }
}

// ─── Calendar rendering ───────────────────────────────────────────────────────
async function renderCalendar() {
  const year        = currentMonth.getFullYear();
  const month       = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDate   = dateKey(year, month + 1, 1);
  const endDate     = dateKey(year, month + 1, daysInMonth);

  const [nutritionMonth, sleepMonth, exerciseMonth] = await Promise.all([
    dbQuery("SELECT date, calories, protein, meal_count FROM daily_nutrition WHERE date >= ? AND date <= ?", [startDate, endDate]),
    dbQuery("SELECT date, hours FROM sleep_logs WHERE date >= ? AND date <= ?", [startDate, endDate]),
    dbQuery("SELECT date, sets, duration_min FROM exercise_logs WHERE date >= ? AND date <= ?", [startDate, endDate])
  ]);

  const nutritionMap = Object.fromEntries(nutritionMonth.map(r => [r.date, r]));
  const sleepMap     = Object.fromEntries(sleepMonth.map(r => [r.date, r]));
  const exerciseMap  = {};
  exerciseMonth.forEach(r => { (exerciseMap[r.date] ??= []).push(r); });

  els.monthLabel.textContent = currentMonth.toLocaleString(undefined, { month: "long", year: "numeric" });
  renderLegend();

  const todayKey     = formatDateKey(new Date());
  const firstWeekday = new Date(year, month, 1).getDay();
  const weekdays     = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fragments    = weekdays.map(d => `<div class="weekday">${d}</div>`);

  for (let i = 0; i < firstWeekday; i++) {
    fragments.push(`<button class="day-cell empty" type="button" tabindex="-1"></button>`);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key        = dateKey(year, month + 1, day);
    const isDisabled = key < MIN_DATE || key > todayKey;
    const data       = getDayDisplayData(key, activeView, nutritionMap, sleepMap, exerciseMap);
    const classes    = ["day-cell", `level-${data.level}`];
    if (isDisabled)      classes.push("disabled");
    if (key === todayKey)     classes.push("today");
    if (key === selectedDate) classes.push("selected");

    fragments.push(`
      <button class="${classes.join(" ")}" type="button"
        data-date="${key}" title="${escapeHtml(data.title)}"
        ${isDisabled ? "tabindex=-1" : ""}>
        <span class="day-number">${day}</span>
        <span class="day-value">${escapeHtml(data.label)}</span>
      </button>`);
  }

  els.calendar.innerHTML = fragments.join("");
}

function renderLegend() {
  const labels = {
    nutrition: ["No meals",    "Light",  "Moderate", "High",   "Very high"],
    sleep:     ["No log",      "< 5h",   "5–7h",     "7–9h",   "9h+"],
    exercise:  ["No exercise", "Small",  "Moderate", "Big",    "Very big"]
  };
  els.legend.innerHTML = labels[activeView].map((label, i) =>
    `<span class="legend-swatch level-${i}"></span><span>${label}</span>`
  ).join("");
}

function getDayDisplayData(date, view, nutritionMap, sleepMap, exerciseMap) {
  if (view === "nutrition") {
    const row = nutritionMap[date];
    if (!row || !Number(row.meal_count)) return { level: 0, label: "-", title: "No nutrition logged" };
    const cal = Number(row.calories) || 0;
    const level = cal >= 2400 ? 4 : cal >= 1600 ? 3 : cal >= 800 ? 2 : 1;
    return { level, label: `${round(cal, 0)} kcal`, title: `${round(cal, 0)} kcal · ${round(row.protein, 1)}g protein` };
  }
  if (view === "sleep") {
    const row = sleepMap[date];
    if (!row) return { level: 0, label: "-", title: "No sleep logged" };
    const h = Number(row.hours) || 0;
    const level = h >= 9 ? 4 : h >= 7 ? 3 : h >= 5 ? 2 : 1;
    return { level, label: `${round(h, 1)} h`, title: `${round(h, 2)} hours slept` };
  }
  const rows = exerciseMap[date] || [];
  if (!rows.length) return { level: 0, label: "-", title: "No exercise logged" };
  const score = rows.reduce((s, r) => s + (Number(r.sets) || 0) + (Number(r.duration_min) || 0) / 10, 0);
  const level = score >= 16 ? 4 : score >= 9 ? 3 : score >= 4 ? 2 : 1;
  return { level, label: `${rows.length} item${rows.length === 1 ? "" : "s"}`, title: `${rows.length} exercise log(s)` };
}

// ─── Selected date rendering ──────────────────────────────────────────────────
async function renderSelectedDate() {
  const prettyDate = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
  els.selectedDateHeading.textContent = prettyDate;

  const [nutrition, sleep, exercises, mealRows, body] = await Promise.all([
    dbOne("SELECT * FROM daily_nutrition WHERE date = ?", [selectedDate]),
    dbOne("SELECT * FROM sleep_logs WHERE date = ?", [selectedDate]),
    dbQuery("SELECT * FROM exercise_logs WHERE date = ? ORDER BY created_at, id", [selectedDate]),
    dbQuery(`SELECT nutrition_logs.*, recipes.name AS recipe_name
             FROM nutrition_logs
             LEFT JOIN recipes ON recipes.id = nutrition_logs.recipe_id
             WHERE nutrition_logs.date = ?
             ORDER BY nutrition_logs.created_at, nutrition_logs.id`, [selectedDate]),
    dbOne("SELECT * FROM body_measurements WHERE date = ?", [selectedDate])
  ]);

  const daily      = nutrition || { calories: 0, protein: 0, fat: 0, carbs: 0, meal_count: 0 };
  const totalSets  = exercises.reduce((s, r) => s + (Number(r.sets) || 0), 0);
  const totalMins  = exercises.reduce((s, r) => s + (Number(r.duration_min) || 0), 0);

  els.summaryCards.innerHTML = `
    <div class="summary-card">
      <span>Nutrition</span>
      <strong>${round(daily.calories, 0)} kcal</strong>
      <small>${round(daily.protein, 1)}g protein</small>
    </div>
    <div class="summary-card">
      <span>Sleep</span>
      <strong>${sleep ? round(sleep.hours, 2) : "—"} h</strong>
      <small>${sleep && sleep.quality ? `Quality ${sleep.quality}/5` : "No rating"}</small>
    </div>
    <div class="summary-card">
      <span>Exercise</span>
      <strong>${exercises.length}</strong>
      <small>${totalSets} sets · ${round(totalMins, 1)} min</small>
    </div>
    <div class="summary-card">
      <span>Body</span>
      <strong>${body && body.weight != null ? round(body.weight, 1) : "—"}</strong>
      <small>${body && body.waist != null ? `Waist ${round(body.waist, 1)}` : "No waist"}</small>
    </div>`;

  renderNutritionList(mealRows, daily);
  renderSleepList(sleep);
  renderExerciseList(exercises);
  renderBodyList(body);
  fillSleepForm(sleep);
  fillBodyForm(body);
}

// ─── List render helpers (synchronous, data passed in) ────────────────────────
function renderNutritionList(rows, nutrition) {
  if (!rows.length) {
    els.nutritionList.innerHTML = `<div class="empty-state">No meals logged for this day yet.</div>`;
    return;
  }
  const records = rows.map(row => {
    const name = row.recipe_name || row.custom_name || "Meal";
    return `<article class="record">
      <div>
        <h4>${escapeHtml(capitalize(row.meal_type))}: ${escapeHtml(name)}</h4>
        <p class="record-meta">${round(row.servings, 2)} serving(s) · ${round(row.calories, 0)} kcal · ${round(row.protein, 1)}g P · ${round(row.fat, 1)}g F · ${round(row.carbs, 1)}g C</p>
        ${row.notes ? `<p>${escapeHtml(row.notes)}</p>` : ""}
      </div>
      <button class="icon-danger" type="button" data-delete="nutrition" data-id="${row.id}">Delete</button>
    </article>`;
  }).join("");
  els.nutritionList.innerHTML = `
    <div class="record">
      <div>
        <h4>Daily total</h4>
        <p class="record-meta">${round(nutrition.calories, 0)} kcal · ${round(nutrition.protein, 1)}g P · ${round(nutrition.fat, 1)}g F · ${round(nutrition.carbs, 1)}g C · ${nutrition.meal_count} meal(s)</p>
      </div>
    </div>${records}`;
}

function renderSleepList(sleep) {
  if (!sleep) {
    els.sleepList.innerHTML = `<div class="empty-state">No sleep logged for this day yet.</div>`;
    return;
  }
  els.sleepList.innerHTML = `<article class="record">
    <div>
      <h4>${round(sleep.hours, 2)} hours slept</h4>
      <p class="record-meta">Quality: ${sleep.quality ? `${sleep.quality}/5` : "not rated"}</p>
      ${sleep.notes ? `<p>${escapeHtml(sleep.notes)}</p>` : ""}
    </div>
    <button class="icon-danger" type="button" data-delete="sleep" data-id="${sleep.id}">Delete</button>
  </article>`;
}

function renderExerciseList(rows) {
  if (!rows.length) {
    els.exerciseList.innerHTML = `<div class="empty-state">No exercises logged for this day yet.</div>`;
    return;
  }
  els.exerciseList.innerHTML = rows.map(row => {
    const strength = [
      row.sets   ? `${row.sets} sets`              : "",
      row.reps   ? `${row.reps} reps`              : "",
      row.weight ? `${round(row.weight, 1)} weight` : ""
    ].filter(Boolean).join(" · ");
    const cardio = [
      row.duration_min ? `${round(row.duration_min, 1)} min`  : "",
      row.distance     ? `${round(row.distance, 2)} distance` : ""
    ].filter(Boolean).join(" · ");
    const details = [strength, cardio].filter(Boolean).join(" · ") || "Details not specified";
    return `<article class="record">
      <div>
        <h4>${escapeHtml(row.exercise_name)}</h4>
        <p class="record-meta">${row.category ? `${escapeHtml(row.category)} · ` : ""}${escapeHtml(details)}</p>
        ${row.notes ? `<p>${escapeHtml(row.notes)}</p>` : ""}
      </div>
      <button class="icon-danger" type="button" data-delete="exercise" data-id="${row.id}">Delete</button>
    </article>`;
  }).join("");
}

function renderBodyList(body) {
  if (!body) {
    els.bodyList.innerHTML = `<div class="empty-state">No measurements for this day yet.</div>`;
    return;
  }
  const parts = [
    body.weight != null ? `Weight: ${round(body.weight, 1)}` : "",
    body.waist  != null ? `Waist: ${round(body.waist, 1)}`   : ""
  ].filter(Boolean).join(" · ");
  els.bodyList.innerHTML = `<article class="record">
    <div>
      <h4>Body measurements</h4>
      <p class="record-meta">${parts || "No values recorded"}</p>
      ${body.notes ? `<p>${escapeHtml(body.notes)}</p>` : ""}
    </div>
    <button class="icon-danger" type="button" data-delete="body" data-id="${body.id}">Delete</button>
  </article>`;
}

// ─── Recipe modal ─────────────────────────────────────────────────────────────
async function refreshRecipeModal() {
  const recipes = await dbQuery("SELECT * FROM recipes ORDER BY name COLLATE NOCASE");
  renderRecipeOptions(recipes);
  renderRecipeList(recipes);
}

function renderRecipeOptions(recipes) {
  const cur = els.recipeSelect.value;
  els.recipeSelect.innerHTML = `<option value="">Custom entry</option>` +
    recipes.map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${round(r.calories, 0)} kcal/serving)</option>`).join("");
  if (recipes.some(r => String(r.id) === cur)) els.recipeSelect.value = cur;
}

function renderRecipeList(recipes) {
  if (!recipes.length) {
    els.recipeList.innerHTML = `<div class="empty-state">No saved recipes yet.</div>`;
    return;
  }
  els.recipeList.innerHTML = recipes.map(r => `
    <article class="record">
      <div>
        <h4>${escapeHtml(r.name)}</h4>
        <p class="record-meta">${r.serving_size ? `${escapeHtml(r.serving_size)} · ` : ""}${round(r.calories, 0)} kcal · ${round(r.protein, 1)}g P · ${round(r.fat, 1)}g F · ${round(r.carbs, 1)}g C</p>
        ${r.notes ? `<p>${escapeHtml(r.notes)}</p>` : ""}
      </div>
      <button class="icon-danger" type="button" data-delete="recipe" data-id="${r.id}">Delete</button>
    </article>`).join("");
}

// ─── Exercise library modal ───────────────────────────────────────────────────
async function refreshExerciseLibModal() {
  exerciseLibrary = await dbQuery("SELECT id, name, category, notes FROM exercises ORDER BY name COLLATE NOCASE");
  if (!exerciseLibrary.length) {
    els.exerciseLibList.innerHTML = `<div class="empty-state">No exercises in library yet.</div>`;
    return;
  }
  els.exerciseLibList.innerHTML = exerciseLibrary.map(ex => `
    <article class="record">
      <div>
        <h4>${escapeHtml(ex.name)}</h4>
        <p class="record-meta">${ex.category ? escapeHtml(ex.category) : "No category"}${ex.notes ? ` · ${escapeHtml(ex.notes)}` : ""}</p>
      </div>
      <button class="icon-danger" type="button" data-delete="exercise-lib" data-id="${ex.id}">Delete</button>
    </article>`).join("");
}

async function populateExerciseLibSelect() {
  exerciseLibrary = await dbQuery("SELECT id, name, category FROM exercises ORDER BY name COLLATE NOCASE");

  // Day-detail exercise dropdown
  const curLib = els.exerciseLibSelect.value;
  els.exerciseLibSelect.innerHTML = `<option value="">Custom…</option>` +
    exerciseLibrary.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  if (exerciseLibrary.some(e => String(e.id) === curLib)) els.exerciseLibSelect.value = curLib;

  // Trend view exercise picker (uses name as value, not id)
  const curTrend = els.exerciseProgressSelect.value;
  els.exerciseProgressSelect.innerHTML = `<option value="">Pick an exercise…</option>` +
    exerciseLibrary.map(e => `<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join("");
  if (curTrend) els.exerciseProgressSelect.value = curTrend;
}

// ─── Form helpers ──────────────────────────────────────────────────────────────
function fillSleepForm(sleep) {
  els.sleepHours.value   = sleep ? sleep.hours : "";
  els.sleepQuality.value = sleep && sleep.quality ? String(sleep.quality) : "";
  els.sleepNotes.value   = sleep ? (sleep.notes || "") : "";
}

function fillBodyForm(body) {
  els.bodyWeight.value = body && body.weight != null ? body.weight : "";
  els.bodyWaist.value  = body && body.waist  != null ? body.waist  : "";
  els.bodyNotes.value  = body ? (body.notes || "") : "";
}

async function fillMealMacrosFromRecipe() {
  const id = nullableInt(els.recipeSelect.value);
  if (!id) return;
  try {
    const recipe = await dbOne("SELECT * FROM recipes WHERE id = ?", [id]);
    if (!recipe) return;
    const servings = numberOrDefault(els.servings.value, 1);
    els.nutritionName.value = recipe.name;
    els.mealCalories.value  = round(recipe.calories * servings, 0);
    els.mealProtein.value   = round(recipe.protein  * servings, 1);
    els.mealFat.value       = round(recipe.fat      * servings, 1);
    els.mealCarbs.value     = round(recipe.carbs    * servings, 1);
  } catch (err) {
    console.error(err);
  }
}

function handleExerciseLibSelectChange() {
  const id  = nullableInt(els.exerciseLibSelect.value);
  const lib = id ? exerciseLibrary.find(e => e.id === id) : null;
  if (lib) {
    els.exerciseCustomLabel.style.display = "none";
    els.exerciseName.value = "";
    els.exerciseCategory.value = lib.category || "";
  } else {
    els.exerciseCustomLabel.style.display = "";
    els.exerciseCategory.value = "";
  }
}

// ─── Form submit handlers ─────────────────────────────────────────────────────
async function handleNutritionSubmit(event) {
  event.preventDefault();
  const recipeId = nullableInt(els.recipeSelect.value);
  const servings = numberOrDefault(els.servings.value, 1);
  let calories = numberOrDefault(els.mealCalories.value, 0);
  let protein  = numberOrDefault(els.mealProtein.value, 0);
  let fat      = numberOrDefault(els.mealFat.value, 0);
  let carbs    = numberOrDefault(els.mealCarbs.value, 0);
  let name     = els.nutritionName.value.trim();

  if (recipeId) {
    const recipe = await dbOne("SELECT * FROM recipes WHERE id = ?", [recipeId]);
    if (recipe) {
      calories = recipe.calories * servings;
      protein  = recipe.protein  * servings;
      fat      = recipe.fat      * servings;
      carbs    = recipe.carbs    * servings;
      name     = name || recipe.name;
    }
  }

  try {
    await dbRun(`INSERT INTO nutrition_logs
      (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [selectedDate, els.mealType.value, recipeId, name || "Custom meal",
       servings, calories, protein, fat, carbs, els.nutritionNotes.value.trim()]);
    await recalculateDailyNutrition(selectedDate);
    els.nutritionForm.reset();
    els.servings.value = "1";
    [els.mealCalories, els.mealProtein, els.mealFat, els.mealCarbs].forEach(inp => { inp.value = "0"; });
    setStatus("Saved");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleSleepSubmit(event) {
  event.preventDefault();
  try {
    await dbRun(`INSERT INTO sleep_logs (date, hours, quality, notes, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date) DO UPDATE SET
        hours = excluded.hours, quality = excluded.quality,
        notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
      [selectedDate, numberOrDefault(els.sleepHours.value, 0),
       nullableInt(els.sleepQuality.value), els.sleepNotes.value.trim()]);
    setStatus("Saved");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleExerciseSubmit(event) {
  event.preventDefault();
  const libId = nullableInt(els.exerciseLibSelect.value);
  const lib   = libId ? exerciseLibrary.find(e => e.id === libId) : null;
  const name  = lib ? lib.name : els.exerciseName.value.trim();
  if (!name) { alert("Please enter an exercise name or select one from the library."); return; }

  try {
    await dbRun(`INSERT INTO exercise_logs
      (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [selectedDate, name,
       els.exerciseCategory.value.trim(),
       nullableInt(els.exerciseSets.value),
       nullableInt(els.exerciseReps.value),
       nullableNumber(els.exerciseWeight.value),
       nullableNumber(els.exerciseDuration.value),
       nullableNumber(els.exerciseDistance.value),
       els.exerciseNotes.value.trim()]);
    els.exerciseForm.reset();
    els.exerciseLibSelect.value = "";
    els.exerciseCustomLabel.style.display = ""; // show custom label again after reset
    setStatus("Saved");
    await renderSelectedDate();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleBodySubmit(event) {
  event.preventDefault();
  try {
    await dbRun(`INSERT INTO body_measurements (date, weight, waist, notes, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date) DO UPDATE SET
        weight = excluded.weight, waist = excluded.waist,
        notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
      [selectedDate, nullableNumber(els.bodyWeight.value),
       nullableNumber(els.bodyWaist.value), els.bodyNotes.value.trim()]);
    setStatus("Saved");
    await renderSelectedDate();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleRecipeSubmit(event) {
  event.preventDefault();
  try {
    await dbRun(`INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        serving_size = excluded.serving_size, calories = excluded.calories,
        protein = excluded.protein, fat = excluded.fat, carbs = excluded.carbs,
        notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`,
      [els.recipeName.value.trim(), els.recipeServingSize.value.trim(),
       numberOrDefault(els.recipeCalories.value, 0), numberOrDefault(els.recipeProtein.value, 0),
       numberOrDefault(els.recipeFat.value, 0), numberOrDefault(els.recipeCarbs.value, 0),
       els.recipeNotes.value.trim()]);
    els.recipeForm.reset();
    [els.recipeCalories, els.recipeProtein, els.recipeFat, els.recipeCarbs].forEach(inp => { inp.value = "0"; });
    setStatus("Saved");
    await refreshRecipeModal();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleExerciseLibSubmit(event) {
  event.preventDefault();
  const name = els.exerciseLibName.value.trim();
  if (!name) return;
  try {
    await dbRun(`INSERT INTO exercises (name, category, notes, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        category = excluded.category, notes = excluded.notes`,
      [name, els.exerciseLibCategory.value.trim(), els.exerciseLibNotes.value.trim()]);
    els.exerciseLibForm.reset();
    setStatus("Saved");
    await refreshExerciseLibModal();
    await populateExerciseLibSelect();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleDeleteButtons(event) {
  const button = event.target.closest("button[data-delete]");
  if (!button) return;
  const type = button.dataset.delete;
  const id   = Number(button.dataset.id);

  try {
    if (type === "nutrition") {
      await dbRun("DELETE FROM nutrition_logs WHERE id = ?", [id]);
      await recalculateDailyNutrition(selectedDate);
    } else if (type === "sleep") {
      await dbRun("DELETE FROM sleep_logs WHERE id = ?", [id]);
    } else if (type === "exercise") {
      await dbRun("DELETE FROM exercise_logs WHERE id = ?", [id]);
    } else if (type === "body") {
      await dbRun("DELETE FROM body_measurements WHERE id = ?", [id]);
    } else if (type === "recipe") {
      await dbRun("DELETE FROM recipes WHERE id = ?", [id]);
      await refreshRecipeModal();
      setStatus("Deleted");
      return; // modal stays open — skip renderAll
    } else if (type === "exercise-lib") {
      await dbRun("DELETE FROM exercises WHERE id = ?", [id]);
      await refreshExerciseLibModal();
      await populateExerciseLibSelect();
      setStatus("Deleted");
      return; // modal stays open — skip renderAll
    }
    setStatus("Deleted");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Delete failed", true);
  }
}

// ─── Data mutations ────────────────────────────────────────────────────────────
async function recalculateDailyNutrition(date) {
  const totals = await dbOne(`SELECT COUNT(*) AS meal_count,
    COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein),0) AS protein,
    COALESCE(SUM(fat),0) AS fat, COALESCE(SUM(carbs),0) AS carbs
    FROM nutrition_logs WHERE date = ?`, [date]);

  if (!totals || Number(totals.meal_count) === 0) {
    await dbRun("DELETE FROM daily_nutrition WHERE date = ?", [date]);
    return;
  }
  await dbRun(`INSERT INTO daily_nutrition (date, calories, protein, fat, carbs, meal_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      calories = excluded.calories, protein = excluded.protein, fat = excluded.fat,
      carbs = excluded.carbs, meal_count = excluded.meal_count, updated_at = CURRENT_TIMESTAMP`,
    [date, totals.calories, totals.protein, totals.fat, totals.carbs, totals.meal_count]);
}

async function addSampleData() {
  setStatus("Adding sample data…", true);
  try {
    const today = selectedDate;

    // Exercise library
    await dbBatch([
      { sql: `INSERT INTO exercises (name, category, notes, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Goblet squat", "Legs", ""] },
      { sql: `INSERT INTO exercises (name, category, notes, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Incline walk", "Cardio", ""] },
      { sql: `INSERT INTO exercises (name, category, notes, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Bench press", "Push", ""] }
    ]);

    // Recipes
    await dbBatch([
      { sql: `INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Greek yogurt bowl", "1 bowl", 420, 38, 8, 48, "Yogurt, berries, oats, honey"] },
      { sql: `INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Chicken rice bowl", "1 bowl", 690, 55, 18, 76, "Chicken breast, rice, vegetables"] },
      { sql: `INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Turkey wrap", "1 wrap", 520, 42, 16, 48, "Turkey, tortilla, cheese, vegetables"] }
    ]);

    const [yogurt, wrap] = await Promise.all([
      dbOne("SELECT * FROM recipes WHERE name = ?", ["Greek yogurt bowl"]),
      dbOne("SELECT * FROM recipes WHERE name = ?", ["Turkey wrap"])
    ]);

    await Promise.all([
      yogurt ? dbRun(`INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [today, "breakfast", yogurt.id, yogurt.name, 1, yogurt.calories, yogurt.protein, yogurt.fat, yogurt.carbs, "Sample breakfast"]) : Promise.resolve(),
      wrap ? dbRun(`INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [today, "lunch", wrap.id, wrap.name, 1, wrap.calories, wrap.protein, wrap.fat, wrap.carbs, "Sample lunch"]) : Promise.resolve(),
      dbRun(`INSERT INTO sleep_logs (date, hours, quality, notes, updated_at) VALUES (?, 7.5, 4, 'Sample sleep log', CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET hours=excluded.hours, quality=excluded.quality, notes=excluded.notes, updated_at=CURRENT_TIMESTAMP`, [today]),
      dbRun(`INSERT INTO exercise_logs (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes) VALUES (?, 'Goblet squat', 'Legs', 3, 10, 40, NULL, NULL, 'Sample strength entry')`, [today]),
      dbRun(`INSERT INTO exercise_logs (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes) VALUES (?, 'Incline walk', 'Cardio', NULL, NULL, NULL, 20, 1.2, 'Sample cardio entry')`, [today]),
      dbRun(`INSERT INTO body_measurements (date, weight, waist, notes, updated_at) VALUES (?, 80.5, 85.0, 'Sample measurement', CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET weight=excluded.weight, waist=excluded.waist, notes=excluded.notes, updated_at=CURRENT_TIMESTAMP`, [today])
    ]);

    await recalculateDailyNutrition(today);
    await populateExerciseLibSelect();
    await refreshRecipeModal();
    setStatus("Sample data added");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Failed to add sample data", true);
  }
}

// ─── Trends view ───────────────────────────────────────────────────────────────
async function renderTrendsView() {
  const todayKey  = formatDateKey(new Date());
  const startDate = dateSpineStart(todayKey, trendDays);

  const [nutRows, sleepRows, exRows, bodyRows] = await Promise.all([
    dbQuery("SELECT date, calories, protein FROM daily_nutrition WHERE date >= ? AND date <= ? ORDER BY date", [startDate, todayKey]),
    dbQuery("SELECT date, hours FROM sleep_logs WHERE date >= ? AND date <= ? ORDER BY date", [startDate, todayKey]),
    dbQuery("SELECT date, COUNT(*) AS count FROM exercise_logs WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date", [startDate, todayKey]),
    dbQuery("SELECT date, weight, waist FROM body_measurements WHERE date >= ? AND date <= ? ORDER BY date", [startDate, todayKey])
  ]);

  const spine = buildDateSpine(startDate, todayKey);

  const charts = [
    { label: "Calories",       color: "#f78166", rows: nutRows,   key: "calories", unit: " kcal" },
    { label: "Protein (g)",    color: "#7ee787", rows: nutRows,   key: "protein",  unit: "g" },
    { label: "Sleep (hours)",  color: "#79c0ff", rows: sleepRows, key: "hours",    unit: "h" },
    { label: "Body Weight",    color: "#e3b341", rows: bodyRows,  key: "weight",   unit: "" },
    { label: "Waist",          color: "#d2a8ff", rows: bodyRows,  key: "waist",    unit: "" },
    { label: "Exercise Count", color: "#58a6ff", rows: exRows,    key: "count",    unit: "" }
  ];

  els.chartsGrid.innerHTML = "";
  charts.forEach(({ label, color, rows, key, unit }) => {
    const map  = Object.fromEntries(rows.map(r => [r.date, r[key] != null ? Number(r[key]) : null]));
    const data = spine.map(d => ({ date: d, value: map[d] ?? null }));
    const card = document.createElement("div");
    card.className = "chart-card";
    const chartId = `chart-${key}`;
    card.innerHTML = `<h3>${escapeHtml(label)}</h3><div id="${chartId}"></div>`;
    els.chartsGrid.appendChild(card);
    renderLineChart(card.querySelector(`#${chartId}`), data, { color, unit });
  });

  await populateExerciseLibSelect();
  if (els.exerciseProgressSelect.value) {
    await renderExerciseProgressChart(els.exerciseProgressSelect.value);
  } else {
    els.exerciseProgressChart.innerHTML = `<div class="chart-empty">Select an exercise above to see progress.</div>`;
  }
}

async function renderExerciseProgressChart(exerciseName) {
  if (!exerciseName) {
    els.exerciseProgressChart.innerHTML = `<div class="chart-empty">Select an exercise above to see progress.</div>`;
    return;
  }
  const todayKey  = formatDateKey(new Date());
  const startDate = dateSpineStart(todayKey, trendDays);

  const rows = await dbQuery(`
    SELECT date,
      MAX(CASE WHEN weight > 0 THEN weight ELSE NULL END) AS max_weight,
      SUM(COALESCE(sets, 0)) AS total_sets
    FROM exercise_logs
    WHERE exercise_name = ? AND date >= ? AND date <= ?
    GROUP BY date ORDER BY date`,
    [exerciseName, startDate, todayKey]);

  const hasWeight = rows.some(r => r.max_weight != null);
  const spine     = buildDateSpine(startDate, todayKey);
  const map       = Object.fromEntries(rows.map(r => [
    r.date, hasWeight ? (r.max_weight != null ? Number(r.max_weight) : null) : Number(r.total_sets)
  ]));
  const data = spine.map(d => ({ date: d, value: map[d] ?? null }));

  renderLineChart(els.exerciseProgressChart, data, {
    color: "#58a6ff",
    unit:  hasWeight ? " lb/kg" : " sets",
    height: 200
  });
}

// ─── SVG line chart ────────────────────────────────────────────────────────────
function renderLineChart(container, points, { color = "#58a6ff", unit = "", height = 140 } = {}) {
  const nonNull = points.filter(p => p.value !== null);
  if (!nonNull.length) {
    container.innerHTML = `<div class="chart-empty">No data for this period</div>`;
    return;
  }

  const W   = 480, H = height;
  const pad = { t: 14, r: 12, b: 28, l: 44 };
  const cW  = W - pad.l - pad.r;
  const cH  = H - pad.t - pad.b;
  const N   = points.length;

  const vals = nonNull.map(p => p.value);
  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);
  if (minV === maxV) { minV -= 1; maxV += 1; }

  const sx = i  => pad.l + (N < 2 ? cW / 2 : (i / (N - 1)) * cW);
  const sy = v  => pad.t + cH - ((v - minV) / (maxV - minV)) * cH;
  const f  = n  => n.toFixed(1);

  // Y-axis ticks
  const yTicks = [0, 0.5, 1].map(t => {
    const v = minV + t * (maxV - minV);
    const y = sy(v);
    return `<line x1="${pad.l}" y1="${f(y)}" x2="${f(pad.l + cW)}" y2="${f(y)}" class="chart-grid"/>
            <text x="${f(pad.l - 4)}" y="${f(y + 4)}" class="chart-tick" text-anchor="end">${round(v, 0)}</text>`;
  }).join("");

  // X-axis ticks (up to 5)
  const xCount = Math.min(5, N);
  const xIdxs  = xCount <= 1 ? [0] : Array.from({ length: xCount }, (_, i) =>
    Math.min(Math.round(i * (N - 1) / (xCount - 1)), N - 1)
  );
  const xTicks = [...new Set(xIdxs)].map(i =>
    `<text x="${f(sx(i))}" y="${H - 4}" class="chart-tick" text-anchor="middle">${points[i].date.slice(5).replace("-", "/")}</text>`
  ).join("");

  // Build line + area paths (handling null gaps)
  let linePath = "", areaPath = "";
  let seg = [];

  const flushSeg = () => {
    if (!seg.length) return;
    const base = f(sy(minV));
    areaPath += `M ${f(seg[0].x)} ${base} ` + seg.map(p => `L ${f(p.x)} ${f(p.y)} `).join("") + `L ${f(seg.at(-1).x)} ${base} Z `;
    linePath += `M ${f(seg[0].x)} ${f(seg[0].y)} ` + seg.slice(1).map(p => `L ${f(p.x)} ${f(p.y)} `).join("");
    seg = [];
  };

  points.forEach((p, i) => {
    if (p.value !== null) seg.push({ x: sx(i), y: sy(p.value) });
    else flushSeg();
  });
  flushSeg();

  // Data point circles (native title tooltip)
  const circles = points.map((p, i) => p.value === null ? "" :
    `<circle cx="${f(sx(i))}" cy="${f(sy(p.value))}" r="3.5" fill="${color}" stroke="var(--panel)" stroke-width="1.5">
      <title>${p.date}: ${round(p.value, 1)}${unit}</title>
    </circle>`
  ).join("");

  // Unique gradient ID per color
  const gid = `g${color.replace(/[^a-z0-9]/gi, "")}`;

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="line-chart">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${yTicks}
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${f(pad.t + cH)}" class="chart-axis"/>
    <line x1="${pad.l}" y1="${f(pad.t + cH)}" x2="${f(pad.l + cW)}" y2="${f(pad.t + cH)}" class="chart-axis"/>
    <path d="${areaPath}" fill="url(#${gid})"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${circles}
    ${xTicks}
  </svg>`;
}

// ─── Date utilities ────────────────────────────────────────────────────────────
function buildDateSpine(startDate, endDate) {
  const spine = [];
  const cur   = new Date(`${startDate}T12:00:00`);
  const end   = new Date(`${endDate}T12:00:00`);
  while (cur <= end) {
    spine.push(formatDateKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return spine;
}

function dateSpineStart(endDate, days) {
  const d = new Date(`${endDate}T12:00:00`);
  d.setDate(d.getDate() - (days - 1));
  return formatDateKey(d);
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function setStatus(text, warning = false) {
  els.dbStatus.textContent = text;
  els.dbStatus.classList.toggle("warn", Boolean(warning));
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateKey(date) {
  return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function numberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableInt(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 1) {
  const n      = Number(value) || 0;
  const factor = 10 ** decimals;
  const r      = Math.round(n * factor) / factor;
  return decimals === 0 ? String(Math.round(r)) : String(r);
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
