// ─── Constants ────────────────────────────────────────────────────────────────
const WORKER_URL_KEY = "fitness_tracker_worker_url";
const AUTH_TOKEN_KEY = "fitness_tracker_auth_token";
const MIN_DATE       = "2026-06-01";

// ─── State ────────────────────────────────────────────────────────────────────
let workerUrl, authToken;
let currentMonth, selectedDate;
let topView    = "calendar";
let trendDays  = 30;

// Exercise logging state
let exerciseLibrary = []; // [{id, name, category, tracking_type, allow_sets_reps, allow_distance}]
let currentExercise = null;
let setCount        = 1;

// Nutrition logging state
let selectedRecipe   = null; // full recipe row when a library recipe is selected
let nutritionByWeight = false;

const els = {};

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  setInitialDates();
  bindEvents();
  renderDotLegend();

  workerUrl = localStorage.getItem(WORKER_URL_KEY) || "";
  authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";

  if (!workerUrl || !authToken) { showConfigModal(); return; }
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
    const newUrl    = modal.querySelector("#configWorkerUrl").value.trim().replace(/\/$/, "");
    const newToken  = modal.querySelector("#configAuthToken").value.trim();
    const errEl     = modal.querySelector("#configError");
    const submitBtn = modal.querySelector("#configSubmitBtn");
    errEl.style.display = "none";
    submitBtn.disabled = true; submitBtn.textContent = "Connecting…";
    try {
      const res = await fetch(`${newUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${newToken}` },
        body: JSON.stringify({ sql: "SELECT 1" })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      workerUrl = newUrl; authToken = newToken;
      localStorage.setItem(WORKER_URL_KEY, workerUrl);
      localStorage.setItem(AUTH_TOKEN_KEY, authToken);
      modal.close(); modal.remove();
      await initApp();
    } catch (err) {
      errEl.textContent = `Could not connect: ${err.message}`;
      errEl.style.display = "";
      submitBtn.disabled = false; submitBtn.textContent = "Connect";
    }
  });
}

// ─── Worker API layer ──────────────────────────────────────────────────────────
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

// ─── Element cache ────────────────────────────────────────────────────────────
function cacheElements() {
  const ids = [
    "addRecipeBtn", "addExerciseLibBtn", "sampleDataBtn", "settingsBtn", "dbStatus",
    "prevMonthBtn", "nextMonthBtn", "todayBtn", "monthLabel", "calendar", "legend",
    "calendarLayout", "trendsLayout", "chartsGrid",
    "exerciseProgressSelect", "exerciseProgressChart", "exerciseProgressCard",
    "selectedDateHeading", "summaryCards",
    // Nutrition form
    "nutritionForm", "mealType", "nutritionIsCustom",
    "nutritionRecipeSection", "recipeSelect",
    "nutritionCustomSection", "nutritionName", "mealCalories", "mealProtein", "mealCarbs", "mealFat",
    "nutritionSaveToLib",
    "nutritionQtyToggle", "qtyServingsBtn", "qtyGramsBtn",
    "nutritionServingsRow", "nutritionGramsRow", "servings", "nutritionGrams",
    "nutritionList",
    // Sleep form
    "sleepForm", "sleepHours", "sleepList",
    // Exercise form
    "exerciseForm", "exerciseLibSelect",
    "exerciseSetsSection", "addSetBtn", "setRows",
    "exerciseDistanceRow", "exerciseDistance",
    "exerciseList",
    // Body form
    "bodyForm", "bodyWeight", "bodyWaist", "bodyList",
    // Recipe modal
    "recipeModal", "recipeModalClose",
    "recipeForm", "recipeName", "recipeCalories", "recipeProtein", "recipeCarbs", "recipeFat",
    "recipeAllowWeight", "recipeGramsPerServingLabel", "recipeGramsPerServing", "recipeList",
    // Exercise lib modal
    "exerciseLibModal", "exerciseLibModalClose",
    "exerciseLibForm", "exerciseLibName", "exerciseLibType",
    "exerciseLibAllowSetsReps", "exerciseLibAllowDistance", "exerciseLibList"
  ];
  ids.forEach(id => { els[id] = document.getElementById(id); });
  els.tabButtons     = Array.from(document.querySelectorAll(".tab-btn"));
  els.tabSections    = Array.from(document.querySelectorAll(".tab-section"));
  els.topViewButtons = Array.from(document.querySelectorAll(".top-view-btn"));
  els.rangeButtons   = Array.from(document.querySelectorAll(".range-btn"));
}

function setInitialDates() {
  const today  = new Date();
  const todayKey = formatDateKey(today);
  currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = todayKey >= MIN_DATE ? todayKey : MIN_DATE;
}

// ─── Event binding ────────────────────────────────────────────────────────────
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

  // Day tabs
  els.tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      els.tabButtons.forEach(b => b.classList.toggle("active", b === btn));
      els.tabSections.forEach(s => s.classList.toggle("active", s.id === btn.dataset.tab));
    });
  });

  // Calendar day click
  els.calendar.addEventListener("click", async (event) => {
    const day = event.target.closest(".day-cell:not(.empty):not(.disabled)");
    if (!day) return;
    document.querySelectorAll(".day-cell.selected").forEach(el => el.classList.remove("selected"));
    day.classList.add("selected");
    selectedDate = day.dataset.date;
    await renderSelectedDate();
  });

  // ── Nutrition form events ──────────────────────────────────────
  els.nutritionIsCustom.addEventListener("change", nutritionIsCustomToggle);
  els.recipeSelect.addEventListener("change", onRecipeChange);
  els.qtyServingsBtn.addEventListener("click", () => setNutritionQtyMode(false));
  els.qtyGramsBtn.addEventListener("click",    () => setNutritionQtyMode(true));
  els.nutritionForm.addEventListener("submit", handleNutritionSubmit);

  // ── Sleep form ─────────────────────────────────────────────────
  els.sleepForm.addEventListener("submit", handleSleepSubmit);

  // ── Exercise form events ───────────────────────────────────────
  els.exerciseLibSelect.addEventListener("change", handleExerciseLibSelectChange);
  els.addSetBtn.addEventListener("click", addSetRow);
  els.setRows.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove-set-btn");
    if (btn) removeSetRow(btn.dataset.set);
  });
  els.exerciseForm.addEventListener("submit", handleExerciseSubmit);

  // ── Body form ──────────────────────────────────────────────────
  els.bodyForm.addEventListener("submit", handleBodySubmit);

  // ── Recipe allow-weight toggle ─────────────────────────────────
  els.recipeAllowWeight.addEventListener("change", () => {
    els.recipeGramsPerServingLabel.style.display = els.recipeAllowWeight.checked ? "" : "none";
  });

  // ── Delete (delegated) ─────────────────────────────────────────
  document.body.addEventListener("click", handleDeleteButtons);

  // ── Top view switcher ──────────────────────────────────────────
  els.topViewButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      topView = btn.dataset.topView;
      els.topViewButtons.forEach(b => b.classList.toggle("active", b === btn));
      await toggleTopView();
    });
  });

  // ── Trend range ────────────────────────────────────────────────
  els.rangeButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      trendDays = Number(btn.dataset.days);
      els.rangeButtons.forEach(b => b.classList.toggle("active", b === btn));
      await renderTrendsView();
    });
  });

  // ── Exercise progress select ───────────────────────────────────
  els.exerciseProgressSelect.addEventListener("change", async () => {
    await renderExerciseProgressChart(els.exerciseProgressSelect.value);
  });

  // ── Recipe modal ───────────────────────────────────────────────
  els.addRecipeBtn.addEventListener("click", async () => {
    await refreshRecipeModal();
    els.recipeModal.showModal();
  });
  els.recipeModalClose.addEventListener("click", () => els.recipeModal.close());
  els.recipeModal.addEventListener("click", e => { if (e.target === els.recipeModal) els.recipeModal.close(); });
  els.recipeForm.addEventListener("submit", handleRecipeSubmit);

  // ── Exercise library modal ─────────────────────────────────────
  els.addExerciseLibBtn.addEventListener("click", async () => {
    await refreshExerciseLibModal();
    els.exerciseLibModal.showModal();
  });
  els.exerciseLibModalClose.addEventListener("click", () => els.exerciseLibModal.close());
  els.exerciseLibModal.addEventListener("click", e => { if (e.target === els.exerciseLibModal) els.exerciseLibModal.close(); });
  els.exerciseLibForm.addEventListener("submit", handleExerciseLibSubmit);

  // ── Misc ───────────────────────────────────────────────────────
  els.sampleDataBtn.addEventListener("click", addSampleData);
  els.settingsBtn.addEventListener("click", () => showConfigModal());
}

// ─── Top view switching ───────────────────────────────────────────────────────
async function toggleTopView() {
  const isCalendar = topView === "calendar";
  els.calendarLayout.style.display = isCalendar ? "" : "none";
  els.trendsLayout.style.display   = isCalendar ? "none" : "";
  if (!isCalendar) await renderTrendsView();
}

// ─── Render router ────────────────────────────────────────────────────────────
async function renderAll() {
  if (topView === "calendar") {
    await Promise.all([renderCalendar(), renderSelectedDate()]);
  } else {
    await renderTrendsView();
  }
}

// ─── Dot legend (rendered once) ───────────────────────────────────────────────
function renderDotLegend() {
  els.legend.innerHTML = `
    <span class="dot dot-nutrition"></span><span>Meals</span>
    <span class="dot dot-sleep"></span><span>Sleep</span>
    <span class="dot dot-exercise"></span><span>Exercise</span>
    <span class="dot dot-body"></span><span>Body</span>`;
}

// ─── Calendar rendering ───────────────────────────────────────────────────────
async function renderCalendar() {
  const year        = currentMonth.getFullYear();
  const month       = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDate   = dateKey(year, month + 1, 1);
  const endDate     = dateKey(year, month + 1, daysInMonth);

  const [nutritionDates, sleepDates, exerciseDates, bodyDates] = await Promise.all([
    dbQuery("SELECT DISTINCT date FROM daily_nutrition WHERE date >= ? AND date <= ?", [startDate, endDate]),
    dbQuery("SELECT DISTINCT date FROM sleep_logs WHERE date >= ? AND date <= ?",      [startDate, endDate]),
    dbQuery("SELECT DISTINCT date FROM exercise_logs WHERE date >= ? AND date <= ?",   [startDate, endDate]),
    dbQuery("SELECT DISTINCT date FROM body_measurements WHERE date >= ? AND date <= ?", [startDate, endDate])
  ]);

  const nutritionSet = new Set(nutritionDates.map(r => r.date));
  const sleepSet     = new Set(sleepDates.map(r => r.date));
  const exerciseSet  = new Set(exerciseDates.map(r => r.date));
  const bodySet      = new Set(bodyDates.map(r => r.date));

  els.monthLabel.textContent = currentMonth.toLocaleString(undefined, { month: "long", year: "numeric" });

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
    const classes    = ["day-cell"];
    if (isDisabled)          classes.push("disabled");
    if (key === todayKey)    classes.push("today");
    if (key === selectedDate) classes.push("selected");

    const dots = [
      nutritionSet.has(key) ? `<span class="dot dot-nutrition" title="Meals logged"></span>` : "",
      sleepSet.has(key)     ? `<span class="dot dot-sleep"     title="Sleep logged"></span>` : "",
      exerciseSet.has(key)  ? `<span class="dot dot-exercise"  title="Exercise logged"></span>` : "",
      bodySet.has(key)      ? `<span class="dot dot-body"      title="Body logged"></span>` : ""
    ].filter(Boolean).join("");

    fragments.push(`
      <button class="${classes.join(" ")}" type="button"
        data-date="${key}" ${isDisabled ? `tabindex="-1"` : ""}>
        <span class="day-number">${day}</span>
        <div class="day-dots">${dots}</div>
      </button>`);
  }

  els.calendar.innerHTML = fragments.join("");
}

// ─── Selected date rendering ──────────────────────────────────────────────────
async function renderSelectedDate() {
  const prettyDate = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
  els.selectedDateHeading.textContent = prettyDate;

  const [nutrition, sleep, mealRows, exercises, body] = await Promise.all([
    dbOne("SELECT * FROM daily_nutrition WHERE date = ?", [selectedDate]),
    dbOne("SELECT * FROM sleep_logs WHERE date = ?", [selectedDate]),
    dbQuery(`SELECT nl.*, r.name AS recipe_name
             FROM nutrition_logs nl
             LEFT JOIN recipes r ON r.id = nl.recipe_id
             WHERE nl.date = ?
             ORDER BY nl.created_at, nl.id`, [selectedDate]),
    dbQuery(`SELECT el.id, el.date, el.exercise_name, el.distance, el.created_at,
                    e.tracking_type, e.category
             FROM exercise_logs el
             LEFT JOIN exercises e ON e.id = el.exercise_id
             WHERE el.date = ?
             ORDER BY el.created_at, el.id`, [selectedDate]),
    dbOne("SELECT * FROM body_measurements WHERE date = ?", [selectedDate])
  ]);

  // Fetch per-set data for exercise logs
  let setsMap = {};
  if (exercises.length > 0) {
    const logIds = exercises.map(e => e.id);
    const allSets = await dbQuery(
      `SELECT * FROM exercise_sets WHERE log_id IN (${logIds.map(() => "?").join(",")}) ORDER BY log_id, set_number`,
      logIds
    );
    allSets.forEach(s => { (setsMap[s.log_id] ??= []).push(s); });
  }

  // Summary cards
  const daily    = nutrition || { calories: 0, protein: 0, fat: 0, carbs: 0, meal_count: 0 };
  const totalSets = Object.values(setsMap).reduce((t, sets) => t + sets.length, 0);
  const totalMins = Object.values(setsMap).reduce(
    (t, sets) => t + sets.reduce((s, r) => s + (Number(r.duration_min) || 0), 0), 0
  );

  els.summaryCards.innerHTML = `
    <div class="summary-card">
      <span>Nutrition</span>
      <strong>${round(daily.calories, 0)} kcal</strong>
      <small>${round(daily.protein, 1)}g protein</small>
    </div>
    <div class="summary-card">
      <span>Sleep</span>
      <strong>${sleep ? round(sleep.hours, 2) : "—"} h</strong>
      <small>${sleep ? "Logged" : "Not logged"}</small>
    </div>
    <div class="summary-card">
      <span>Exercise</span>
      <strong>${exercises.length}</strong>
      <small>${totalSets} sets${totalMins > 0 ? ` · ${round(totalMins, 0)} min` : ""}</small>
    </div>
    <div class="summary-card">
      <span>Body</span>
      <strong>${body && body.weight != null ? `${round(body.weight, 1)} lb` : "—"}</strong>
      <small>${body && body.waist != null ? `${round(body.waist, 1)} in waist` : "No waist"}</small>
    </div>`;

  renderNutritionList(mealRows, daily);
  renderSleepList(sleep);
  renderExerciseList(exercises, setsMap);
  renderBodyList(body);
  fillSleepForm(sleep);
  fillBodyForm(body);
}

// ─── List render helpers ──────────────────────────────────────────────────────
function renderNutritionList(rows, nutrition) {
  if (!rows.length) {
    els.nutritionList.innerHTML = `<div class="empty-state">No meals logged for this day yet.</div>`;
    return;
  }
  const records = rows.map(row => {
    const name = row.recipe_name || row.custom_name || "Meal";
    const qty  = row.grams != null
      ? `${round(row.grams, 0)} g`
      : `${round(row.servings, 2)} serving(s)`;
    return `<article class="record">
      <div>
        <h4>${escapeHtml(capitalize(row.meal_type))}: ${escapeHtml(name)}</h4>
        <p class="record-meta">${qty} · ${round(row.calories, 0)} kcal · ${round(row.protein, 1)}g P · ${round(row.fat, 1)}g F · ${round(row.carbs, 1)}g C</p>
      </div>
      <button class="icon-danger" type="button" data-delete="nutrition" data-id="${row.id}">Delete</button>
    </article>`;
  }).join("");
  els.nutritionList.innerHTML = `
    <div class="record">
      <div>
        <h4>Daily total</h4>
        <p class="record-meta">${round(daily_val(nutrition, "calories"), 0)} kcal · ${round(daily_val(nutrition, "protein"), 1)}g P · ${round(daily_val(nutrition, "fat"), 1)}g F · ${round(daily_val(nutrition, "carbs"), 1)}g C · ${nutrition.meal_count} meal(s)</p>
      </div>
    </div>${records}`;
}

function daily_val(n, k) { return Number(n?.[k]) || 0; }

function renderSleepList(sleep) {
  if (!sleep) {
    els.sleepList.innerHTML = `<div class="empty-state">No sleep logged for this day yet.</div>`;
    return;
  }
  els.sleepList.innerHTML = `<article class="record">
    <div>
      <h4>${round(sleep.hours, 2)} hours slept</h4>
    </div>
    <button class="icon-danger" type="button" data-delete="sleep" data-id="${sleep.id}">Delete</button>
  </article>`;
}

function renderExerciseList(exercises, setsMap) {
  if (!exercises.length) {
    els.exerciseList.innerHTML = `<div class="empty-state">No exercises logged for this day yet.</div>`;
    return;
  }
  els.exerciseList.innerHTML = exercises.map(row => {
    const sets         = setsMap[row.id] || [];
    const trackingType = row.tracking_type || "weight";
    let setsHtml = "";
    if (sets.length) {
      const badges = sets.map(s => {
        const parts = [];
        if (trackingType === "weight" && s.weight    != null) parts.push(`${round(s.weight, 1)} lb/kg`);
        if (trackingType === "time"   && s.duration_min != null) parts.push(`${round(s.duration_min, 1)} min`);
        if (s.reps != null) parts.push(`${s.reps} reps`);
        return `<span class="set-badge">Set ${s.set_number}: ${parts.join(" × ") || "—"}</span>`;
      }).join("");
      setsHtml = `<div class="set-list">${badges}</div>`;
    }
    const extras = [
      row.category ? escapeHtml(row.category) : "",
      row.distance  ? `${round(row.distance, 2)} km/mi` : ""
    ].filter(Boolean).join(" · ");

    return `<article class="record">
      <div>
        <h4>${escapeHtml(row.exercise_name)}</h4>
        ${extras ? `<p class="record-meta">${extras}</p>` : ""}
        ${setsHtml}
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
    body.weight != null ? `Weight: ${round(body.weight, 1)} lb` : "",
    body.waist  != null ? `Waist: ${round(body.waist, 1)} in`  : ""
  ].filter(Boolean).join(" · ");
  els.bodyList.innerHTML = `<article class="record">
    <div>
      <h4>Body measurements</h4>
      <p class="record-meta">${parts || "No values recorded"}</p>
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
  els.recipeSelect.innerHTML = `<option value="">Select a recipe…</option>` +
    recipes.map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${round(r.calories, 0)} kcal/srv)</option>`).join("");
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
        <p class="record-meta">${round(r.calories, 0)} kcal · ${round(r.protein, 1)}g P · ${round(r.fat, 1)}g F · ${round(r.carbs, 1)}g C${r.grams_per_serving ? ` · ${r.grams_per_serving}g/srv` : ""}</p>
      </div>
      <button class="icon-danger" type="button" data-delete="recipe" data-id="${r.id}">Delete</button>
    </article>`).join("");
}

// ─── Exercise library modal ───────────────────────────────────────────────────
async function refreshExerciseLibModal() {
  exerciseLibrary = await dbQuery(
    "SELECT id, name, category, tracking_type, allow_sets_reps, allow_distance FROM exercises ORDER BY name COLLATE NOCASE"
  );
  if (!exerciseLibrary.length) {
    els.exerciseLibList.innerHTML = `<div class="empty-state">No exercises in library yet.</div>`;
    return;
  }
  els.exerciseLibList.innerHTML = exerciseLibrary.map(ex => {
    const flags = [
      ex.tracking_type === "time" ? "Time-based" : "Weight-based",
      ex.allow_sets_reps ? "Sets/reps"  : "",
      ex.allow_distance  ? "Distance"   : ""
    ].filter(Boolean).join(" · ");
    return `<article class="record">
      <div>
        <h4>${escapeHtml(ex.name)}</h4>
        <p class="record-meta">${ex.category ? `${escapeHtml(ex.category)} · ` : ""}${flags}</p>
      </div>
      <button class="icon-danger" type="button" data-delete="exercise-lib" data-id="${ex.id}">Delete</button>
    </article>`;
  }).join("");
}

async function populateExerciseLibSelect() {
  exerciseLibrary = await dbQuery(
    "SELECT id, name, category, tracking_type, allow_sets_reps, allow_distance FROM exercises ORDER BY name COLLATE NOCASE"
  );
  const curLib   = els.exerciseLibSelect.value;
  const curTrend = els.exerciseProgressSelect.value;

  els.exerciseLibSelect.innerHTML = `<option value="">Select an exercise…</option>` +
    exerciseLibrary.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  if (exerciseLibrary.some(e => String(e.id) === curLib)) els.exerciseLibSelect.value = curLib;

  els.exerciseProgressSelect.innerHTML = `<option value="">Pick an exercise…</option>` +
    exerciseLibrary.map(e => `<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join("");
  if (curTrend) els.exerciseProgressSelect.value = curTrend;
}

// ─── Nutrition form helpers ───────────────────────────────────────────────────
function nutritionIsCustomToggle() {
  const isCustom = els.nutritionIsCustom.checked;
  els.nutritionRecipeSection.style.display = isCustom ? "none" : "";
  els.nutritionCustomSection.style.display = isCustom ? ""     : "none";
  // Reset quantity toggle
  selectedRecipe   = null;
  nutritionByWeight = false;
  els.nutritionQtyToggle.style.display = "none";
  els.nutritionServingsRow.style.display = "";
  els.nutritionGramsRow.style.display    = "none";
}

async function onRecipeChange() {
  const id = nullableInt(els.recipeSelect.value);
  if (!id) {
    selectedRecipe   = null;
    nutritionByWeight = false;
    els.nutritionQtyToggle.style.display   = "none";
    els.nutritionServingsRow.style.display = "";
    els.nutritionGramsRow.style.display    = "none";
    return;
  }
  try {
    selectedRecipe = await dbOne("SELECT * FROM recipes WHERE id = ?", [id]);
    const allowWeight = selectedRecipe && selectedRecipe.allow_weight_logging;
    els.nutritionQtyToggle.style.display = allowWeight ? "flex" : "none";
    if (!allowWeight) {
      nutritionByWeight = false;
      els.nutritionServingsRow.style.display = "";
      els.nutritionGramsRow.style.display    = "none";
    }
  } catch (err) {
    console.error(err);
  }
}

function setNutritionQtyMode(byGrams) {
  nutritionByWeight = byGrams;
  els.qtyServingsBtn.classList.toggle("active", !byGrams);
  els.qtyGramsBtn.classList.toggle("active",    byGrams);
  els.nutritionServingsRow.style.display = byGrams ? "none" : "";
  els.nutritionGramsRow.style.display    = byGrams ? ""     : "none";
}

// ─── Exercise form helpers ────────────────────────────────────────────────────
function handleExerciseLibSelectChange() {
  const id = nullableInt(els.exerciseLibSelect.value);
  currentExercise = id ? (exerciseLibrary.find(e => e.id === id) || null) : null;
  setCount = 1;

  if (currentExercise && currentExercise.allow_sets_reps) {
    els.exerciseSetsSection.style.display = "";
    renderSetRows();
  } else {
    els.exerciseSetsSection.style.display = "none";
    els.setRows.innerHTML = "";
  }

  els.exerciseDistanceRow.style.display =
    currentExercise && currentExercise.allow_distance ? "" : "none";
  if (els.exerciseDistance) els.exerciseDistance.value = "";
}

function renderSetRows() {
  els.setRows.innerHTML = "";
  for (let i = 1; i <= setCount; i++) {
    els.setRows.appendChild(createSetRow(i));
  }
}

function createSetRow(num) {
  const div = document.createElement("div");
  div.className = "set-row";
  div.dataset.setNum = num;

  const trackingType = currentExercise?.tracking_type ?? "weight";
  const valueField = trackingType === "weight"
    ? `<label>Weight (lb/kg)<input type="number" min="0" step="0.5" class="set-weight" /></label>`
    : `<label>Duration (min)<input type="number" min="0" step="0.5" class="set-duration" /></label>`;

  div.innerHTML = `
    <span class="set-num">Set ${num}</span>
    ${valueField}
    <label>Reps<input type="number" min="0" step="1" class="set-reps" /></label>
    <button type="button" class="icon-danger remove-set-btn" data-set="${num}"
      style="${setCount <= 1 ? "visibility:hidden" : ""}">×</button>`;
  return div;
}

function addSetRow() {
  setCount++;
  // Show remove buttons on all rows now that we have >1
  els.setRows.querySelectorAll(".remove-set-btn").forEach(b => { b.style.visibility = ""; });
  els.setRows.appendChild(createSetRow(setCount));
}

function removeSetRow(setNumStr) {
  const num = Number(setNumStr);
  const row = els.setRows.querySelector(`.set-row[data-set-num="${num}"]`);
  if (row) row.remove();
  // Renumber remaining rows
  setCount = 0;
  els.setRows.querySelectorAll(".set-row").forEach(r => {
    setCount++;
    r.dataset.setNum = setCount;
    r.querySelector(".set-num").textContent = `Set ${setCount}`;
    const btn = r.querySelector(".remove-set-btn");
    if (btn) {
      btn.dataset.set = setCount;
      btn.style.visibility = setCount <= 1 ? "hidden" : "";
    }
  });
}

function collectSets() {
  const sets = [];
  els.setRows.querySelectorAll(".set-row").forEach((row, idx) => {
    const weightEl   = row.querySelector(".set-weight");
    const durationEl = row.querySelector(".set-duration");
    const repsEl     = row.querySelector(".set-reps");
    sets.push({
      set_number:   idx + 1,
      weight:       weightEl   ? nullableNumber(weightEl.value)   : null,
      duration_min: durationEl ? nullableNumber(durationEl.value) : null,
      reps:         repsEl     ? nullableInt(repsEl.value)         : null
    });
  });
  return sets;
}

// ─── Form fills ───────────────────────────────────────────────────────────────
function fillSleepForm(sleep) {
  els.sleepHours.value = sleep ? sleep.hours : "";
}

function fillBodyForm(body) {
  els.bodyWeight.value = body && body.weight != null ? body.weight : "";
  els.bodyWaist.value  = body && body.waist  != null ? body.waist  : "";
}

// ─── Submit handlers ──────────────────────────────────────────────────────────
async function handleNutritionSubmit(event) {
  event.preventDefault();
  const isCustom = els.nutritionIsCustom.checked;

  let recipeId, customName, calories, protein, fat, carbs, servings, grams;

  if (isCustom) {
    customName = els.nutritionName.value.trim() || "Custom meal";
    const perSrv = {
      cal:  numberOrDefault(els.mealCalories.value, 0),
      pro:  numberOrDefault(els.mealProtein.value,  0),
      fat:  numberOrDefault(els.mealFat.value,      0),
      carb: numberOrDefault(els.mealCarbs.value,    0)
    };
    servings = numberOrDefault(els.servings.value, 1);
    grams    = null;
    recipeId = null;
    calories = perSrv.cal  * servings;
    protein  = perSrv.pro  * servings;
    fat      = perSrv.fat  * servings;
    carbs    = perSrv.carb * servings;

    if (els.nutritionSaveToLib.checked && els.nutritionName.value.trim()) {
      await dbRun(
        `INSERT INTO recipes (name, calories, protein, fat, carbs, allow_weight_logging, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO NOTHING`,
        [customName, perSrv.cal, perSrv.pro, perSrv.fat, perSrv.carb]
      ).catch(console.error);
      await refreshRecipeModal();
    }
  } else {
    const id = nullableInt(els.recipeSelect.value);
    if (!id) { alert("Please select a recipe, or check "Custom / one-time entry"."); return; }
    const recipe = selectedRecipe || await dbOne("SELECT * FROM recipes WHERE id = ?", [id]);
    if (!recipe) return;
    recipeId   = recipe.id;
    customName = recipe.name;

    if (nutritionByWeight) {
      grams    = numberOrDefault(els.nutritionGrams.value, 0);
      servings = recipe.grams_per_serving ? grams / recipe.grams_per_serving : 1;
    } else {
      servings = numberOrDefault(els.servings.value, 1);
      grams    = null;
    }

    calories = recipe.calories * servings;
    protein  = recipe.protein  * servings;
    fat      = recipe.fat      * servings;
    carbs    = recipe.carbs    * servings;
  }

  try {
    await dbRun(
      `INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, grams, calories, protein, fat, carbs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [selectedDate, els.mealType.value, recipeId, customName,
       servings, grams, calories, protein, fat, carbs]
    );
    await recalculateDailyNutrition(selectedDate);
    // Reset form
    els.nutritionForm.reset();
    selectedRecipe   = null;
    nutritionByWeight = false;
    els.nutritionQtyToggle.style.display   = "none";
    els.nutritionServingsRow.style.display = "";
    els.nutritionGramsRow.style.display    = "none";
    els.nutritionRecipeSection.style.display = "";
    els.nutritionCustomSection.style.display = "none";
    els.servings.value = "1";
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
    await dbRun(
      `INSERT INTO sleep_logs (date, hours, quality, notes, updated_at)
       VALUES (?, ?, NULL, '', CURRENT_TIMESTAMP)
       ON CONFLICT(date) DO UPDATE SET
         hours = excluded.hours, updated_at = CURRENT_TIMESTAMP`,
      [selectedDate, numberOrDefault(els.sleepHours.value, 0)]
    );
    setStatus("Saved");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleExerciseSubmit(event) {
  event.preventDefault();
  const id = nullableInt(els.exerciseLibSelect.value);
  if (!id || !currentExercise) {
    alert("Please select an exercise from the library.");
    return;
  }
  const distance = nullableNumber(els.exerciseDistance?.value);
  const sets     = currentExercise.allow_sets_reps ? collectSets() : [];

  try {
    const logResult = await dbRun(
      `INSERT INTO exercise_logs (date, exercise_id, exercise_name, category, distance, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [selectedDate, currentExercise.id, currentExercise.name,
       currentExercise.category || "", distance]
    );
    const logId = logResult.meta?.last_row_id;

    if (logId && sets.length > 0) {
      await dbBatch(sets.map(s => ({
        sql: `INSERT INTO exercise_sets (log_id, set_number, weight, reps, duration_min) VALUES (?, ?, ?, ?, ?)`,
        params: [logId, s.set_number, s.weight, s.reps, s.duration_min]
      })));
    }

    // Reset form
    els.exerciseLibSelect.value = "";
    currentExercise = null;
    setCount = 1;
    els.exerciseSetsSection.style.display = "none";
    els.exerciseDistanceRow.style.display = "none";
    els.setRows.innerHTML = "";
    if (els.exerciseDistance) els.exerciseDistance.value = "";

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
    await dbRun(
      `INSERT INTO body_measurements (date, weight, waist, notes, updated_at)
       VALUES (?, ?, ?, '', CURRENT_TIMESTAMP)
       ON CONFLICT(date) DO UPDATE SET
         weight = excluded.weight, waist = excluded.waist, updated_at = CURRENT_TIMESTAMP`,
      [selectedDate, nullableNumber(els.bodyWeight.value), nullableNumber(els.bodyWaist.value)]
    );
    setStatus("Saved");
    await renderSelectedDate();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleRecipeSubmit(event) {
  event.preventDefault();
  const allowWeight      = els.recipeAllowWeight.checked;
  const gramsPerServing  = allowWeight ? nullableNumber(els.recipeGramsPerServing.value) : null;
  try {
    await dbRun(
      `INSERT INTO recipes (name, calories, protein, fat, carbs, allow_weight_logging, grams_per_serving, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         calories = excluded.calories, protein = excluded.protein,
         fat = excluded.fat, carbs = excluded.carbs,
         allow_weight_logging = excluded.allow_weight_logging,
         grams_per_serving = excluded.grams_per_serving,
         updated_at = CURRENT_TIMESTAMP`,
      [els.recipeName.value.trim(),
       numberOrDefault(els.recipeCalories.value, 0), numberOrDefault(els.recipeProtein.value, 0),
       numberOrDefault(els.recipeFat.value, 0),      numberOrDefault(els.recipeCarbs.value, 0),
       allowWeight ? 1 : 0, gramsPerServing]
    );
    els.recipeForm.reset();
    els.recipeGramsPerServingLabel.style.display = "none";
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
    await dbRun(
      `INSERT INTO exercises (name, category, tracking_type, allow_sets_reps, allow_distance, created_at)
       VALUES (?, '', ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         tracking_type = excluded.tracking_type,
         allow_sets_reps = excluded.allow_sets_reps,
         allow_distance = excluded.allow_distance`,
      [name,
       els.exerciseLibType.value,
       els.exerciseLibAllowSetsReps.checked ? 1 : 0,
       els.exerciseLibAllowDistance.checked ? 1 : 0]
    );
    els.exerciseLibForm.reset();
    els.exerciseLibAllowSetsReps.checked = true; // restore default
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
      // Manually cascade since SQLite foreign_keys may be off
      await dbBatch([
        { sql: "DELETE FROM exercise_sets WHERE log_id = ?", params: [id] },
        { sql: "DELETE FROM exercise_logs WHERE id = ?",     params: [id] }
      ]);
    } else if (type === "body") {
      await dbRun("DELETE FROM body_measurements WHERE id = ?", [id]);
    } else if (type === "recipe") {
      await dbRun("DELETE FROM recipes WHERE id = ?", [id]);
      await refreshRecipeModal();
      setStatus("Deleted");
      return;
    } else if (type === "exercise-lib") {
      await dbRun("DELETE FROM exercises WHERE id = ?", [id]);
      await refreshExerciseLibModal();
      await populateExerciseLibSelect();
      setStatus("Deleted");
      return;
    }
    setStatus("Deleted");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Delete failed", true);
  }
}

// ─── Data mutations ───────────────────────────────────────────────────────────
async function recalculateDailyNutrition(date) {
  const totals = await dbOne(
    `SELECT COUNT(*) AS meal_count,
       COALESCE(SUM(calories), 0) AS calories, COALESCE(SUM(protein), 0) AS protein,
       COALESCE(SUM(fat), 0) AS fat,           COALESCE(SUM(carbs),   0) AS carbs
     FROM nutrition_logs WHERE date = ?`, [date]
  );
  if (!totals || Number(totals.meal_count) === 0) {
    await dbRun("DELETE FROM daily_nutrition WHERE date = ?", [date]);
    return;
  }
  await dbRun(
    `INSERT INTO daily_nutrition (date, calories, protein, fat, carbs, meal_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(date) DO UPDATE SET
       calories = excluded.calories, protein = excluded.protein, fat = excluded.fat,
       carbs = excluded.carbs, meal_count = excluded.meal_count, updated_at = CURRENT_TIMESTAMP`,
    [date, totals.calories, totals.protein, totals.fat, totals.carbs, totals.meal_count]
  );
}

async function addSampleData() {
  setStatus("Adding sample data…", true);
  try {
    const today = selectedDate;

    // Exercise library
    await dbBatch([
      { sql: `INSERT INTO exercises (name, category, tracking_type, allow_sets_reps, allow_distance, created_at) VALUES (?, 'Legs',  'weight', 1, 0, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Goblet squat"] },
      { sql: `INSERT INTO exercises (name, category, tracking_type, allow_sets_reps, allow_distance, created_at) VALUES (?, 'Cardio','time',   0, 1, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Incline walk"] },
      { sql: `INSERT INTO exercises (name, category, tracking_type, allow_sets_reps, allow_distance, created_at) VALUES (?, 'Push',  'weight', 1, 0, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Bench press"] }
    ]);

    // Recipes
    await dbBatch([
      { sql: `INSERT INTO recipes (name, calories, protein, fat, carbs, allow_weight_logging, grams_per_serving, updated_at) VALUES (?, 420, 38, 8, 48, 0, NULL, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Greek yogurt bowl"] },
      { sql: `INSERT INTO recipes (name, calories, protein, fat, carbs, allow_weight_logging, grams_per_serving, updated_at) VALUES (?, 690, 55, 18, 76, 1, 400,  CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Chicken rice bowl"] },
      { sql: `INSERT INTO recipes (name, calories, protein, fat, carbs, allow_weight_logging, grams_per_serving, updated_at) VALUES (?, 520, 42, 16, 48, 0, NULL, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`, params: ["Turkey wrap"] }
    ]);

    await populateExerciseLibSelect();
    await refreshRecipeModal();

    const [yogurt, wrap, squat, walk] = await Promise.all([
      dbOne("SELECT * FROM recipes WHERE name = ?",   ["Greek yogurt bowl"]),
      dbOne("SELECT * FROM recipes WHERE name = ?",   ["Turkey wrap"]),
      dbOne("SELECT * FROM exercises WHERE name = ?", ["Goblet squat"]),
      dbOne("SELECT * FROM exercises WHERE name = ?", ["Incline walk"])
    ]);

    // Meals
    const nutritionInserts = [];
    if (yogurt) nutritionInserts.push(
      dbRun(`INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, grams, calories, protein, fat, carbs) VALUES (?, 'breakfast', ?, ?, 1, NULL, ?, ?, ?, ?)`,
        [today, yogurt.id, yogurt.name, yogurt.calories, yogurt.protein, yogurt.fat, yogurt.carbs])
    );
    if (wrap) nutritionInserts.push(
      dbRun(`INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, grams, calories, protein, fat, carbs) VALUES (?, 'lunch', ?, ?, 1, NULL, ?, ?, ?, ?)`,
        [today, wrap.id, wrap.name, wrap.calories, wrap.protein, wrap.fat, wrap.carbs])
    );

    // Exercise logs with sets
    let sqLogId = null, walkLogId = null;
    if (squat) {
      const r = await dbRun(
        `INSERT INTO exercise_logs (date, exercise_id, exercise_name, category, distance) VALUES (?, ?, ?, ?, NULL)`,
        [today, squat.id, squat.name, squat.category || "Legs"]
      );
      sqLogId = r.meta?.last_row_id;
    }
    if (walk) {
      const r = await dbRun(
        `INSERT INTO exercise_logs (date, exercise_id, exercise_name, category, distance) VALUES (?, ?, ?, ?, 1.2)`,
        [today, walk.id, walk.name, walk.category || "Cardio"]
      );
      walkLogId = r.meta?.last_row_id;
    }

    const setInserts = [];
    if (sqLogId) setInserts.push(
      { sql: `INSERT INTO exercise_sets (log_id, set_number, weight, reps) VALUES (?, 1, 40, 10)`, params: [sqLogId] },
      { sql: `INSERT INTO exercise_sets (log_id, set_number, weight, reps) VALUES (?, 2, 40, 10)`, params: [sqLogId] },
      { sql: `INSERT INTO exercise_sets (log_id, set_number, weight, reps) VALUES (?, 3, 42.5, 8)`, params: [sqLogId] }
    );

    await Promise.all([
      ...nutritionInserts,
      setInserts.length ? dbBatch(setInserts) : Promise.resolve(),
      dbRun(`INSERT INTO sleep_logs (date, hours, quality, notes, updated_at) VALUES (?, 7.5, NULL, '', CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET hours=excluded.hours, updated_at=CURRENT_TIMESTAMP`, [today]),
      dbRun(`INSERT INTO body_measurements (date, weight, waist, notes, updated_at) VALUES (?, 175.5, 32.0, '', CURRENT_TIMESTAMP) ON CONFLICT(date) DO UPDATE SET weight=excluded.weight, waist=excluded.waist, updated_at=CURRENT_TIMESTAMP`, [today])
    ]);

    await recalculateDailyNutrition(today);
    setStatus("Sample data added");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Failed to add sample data", true);
  }
}

// ─── Trends view ──────────────────────────────────────────────────────────────
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
    { label: "Body Weight (lb)", color: "#e3b341", rows: bodyRows, key: "weight", unit: " lb" },
    { label: "Waist (in)",     color: "#d2a8ff", rows: bodyRows,  key: "waist",   unit: " in" },
    { label: "Exercise Count", color: "#58a6ff", rows: exRows,    key: "count",   unit: "" }
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

  // Get per-set max weight or total sets per day via exercise_sets JOIN
  const rows = await dbQuery(`
    SELECT el.date,
      MAX(es.weight) AS max_weight,
      SUM(CASE WHEN es.id IS NOT NULL THEN 1 ELSE 0 END) AS total_sets
    FROM exercise_logs el
    LEFT JOIN exercise_sets es ON es.log_id = el.id
    WHERE el.exercise_name = ? AND el.date >= ? AND el.date <= ?
    GROUP BY el.date ORDER BY el.date`,
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

// ─── SVG line chart ───────────────────────────────────────────────────────────
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

  const sx = i => pad.l + (N < 2 ? cW / 2 : (i / (N - 1)) * cW);
  const sy = v => pad.t + cH - ((v - minV) / (maxV - minV)) * cH;
  const f  = n => n.toFixed(1);

  const yTicks = [0, 0.5, 1].map(t => {
    const v = minV + t * (maxV - minV);
    const y = sy(v);
    return `<line x1="${pad.l}" y1="${f(y)}" x2="${f(pad.l + cW)}" y2="${f(y)}" class="chart-grid"/>
            <text x="${f(pad.l - 4)}" y="${f(y + 4)}" class="chart-tick" text-anchor="end">${round(v, 0)}</text>`;
  }).join("");

  const xCount = Math.min(5, N);
  const xIdxs  = xCount <= 1 ? [0] : Array.from({ length: xCount }, (_, i) =>
    Math.min(Math.round(i * (N - 1) / (xCount - 1)), N - 1)
  );
  const xTicks = [...new Set(xIdxs)].map(i =>
    `<text x="${f(sx(i))}" y="${H - 4}" class="chart-tick" text-anchor="middle">${points[i].date.slice(5).replace("-", "/")}</text>`
  ).join("");

  let linePath = "", areaPath = "";
  let seg = [];

  const flushSeg = () => {
    if (!seg.length) return;
    const base = f(sy(minV));
    areaPath += `M ${f(seg[0].x)} ${base} ` + seg.map(p => `L ${f(p.x)} ${f(p.y)} `).join("") + `L ${f(seg.at(-1).x)} ${base} Z `;
    linePath  += `M ${f(seg[0].x)} ${f(seg[0].y)} ` + seg.slice(1).map(p => `L ${f(p.x)} ${f(p.y)} `).join("");
    seg = [];
  };

  points.forEach((p, i) => {
    if (p.value !== null) seg.push({ x: sx(i), y: sy(p.value) });
    else flushSeg();
  });
  flushSeg();

  const circles = points.map((p, i) => p.value === null ? "" :
    `<circle cx="${f(sx(i))}" cy="${f(sy(p.value))}" r="3.5" fill="${color}" stroke="var(--panel)" stroke-width="1.5">
      <title>${p.date}: ${round(p.value, 1)}${unit}</title>
    </circle>`
  ).join("");

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

// ─── Date utilities ───────────────────────────────────────────────────────────
function buildDateSpine(startDate, endDate) {
  const spine = [];
  const cur   = new Date(`${startDate}T12:00:00`);
  const end   = new Date(`${endDate}T12:00:00`);
  while (cur <= end) { spine.push(formatDateKey(cur)); cur.setDate(cur.getDate() + 1); }
  return spine;
}

function dateSpineStart(endDate, days) {
  const d = new Date(`${endDate}T12:00:00`);
  d.setDate(d.getDate() - (days - 1));
  return formatDateKey(d);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
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
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableInt(value) {
  if (value === "" || value == null) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 1) {
  const n      = Number(value) || 0;
  const factor = 10 ** decimals;
  return decimals === 0
    ? String(Math.round(n))
    : String(Math.round(n * factor) / factor);
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
