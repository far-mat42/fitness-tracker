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
let selectedRecipe    = null; // full recipe row when a library recipe is selected
let nutritionByWeight = false;

// Recipe edit state
let editingRecipeId = null; // null = add mode, number = editing that recipe's id

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
    await dbRun(`
      INSERT INTO daily_nutrition (date, calories, protein, fat, carbs, meal_count, updated_at)
      SELECT date,
        COALESCE(SUM(calories), 0), COALESCE(SUM(protein), 0),
        COALESCE(SUM(fat), 0),      COALESCE(SUM(carbs), 0),
        COUNT(*), CURRENT_TIMESTAMP
      FROM nutrition_logs GROUP BY date
      ON CONFLICT(date) DO UPDATE SET
        calories   = excluded.calories,   protein    = excluded.protein,
        fat        = excluded.fat,        carbs      = excluded.carbs,
        meal_count = excluded.meal_count, updated_at = excluded.updated_at`);
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
    "addRecipeBtn", "addExerciseLibBtn", "sampleDataBtn", "exportBtn", "settingsBtn", "dbStatus",
    "prevMonthBtn", "nextMonthBtn", "todayBtn", "monthLabel", "calendar", "legend",
    "calendarLayout", "trendsLayout", "chartsGrid",
    "exerciseProgressSelect", "exerciseProgressChart", "exerciseProgressCard",
    "selectedDateHeading", "summaryCards",
    // Nutrition form
    "nutritionForm", "mealType", "nutritionIsCustom",
    "nutritionRecipeSection", "recipeSelect",
    "nutritionCustomSection", "nutritionName", "mealCalories", "mealProtein", "mealCarbs", "mealFat",
    "nutritionSaveToLib",
    "nutritionQtyToggle", "qtyServingsBtn", "qtyGramsBtn", "nutritionWeightUnitLabel",
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
    "recipeAllowWeight", "recipeGramsPerServingLabel", "recipeGramsPerServing", "recipeWeightUnit", "recipeList",
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

  // Searchable select instances (back the hidden inputs already cached above)
  els.recipeSearchable   = new SearchableSelect("recipeSelectHost",      els.recipeSelect,      { placeholder: "Search recipes…" });
  els.exerciseSearchable = new SearchableSelect("exerciseLibSelectHost",  els.exerciseLibSelect, { placeholder: "Search exercises…" });
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

  // ── Edit / Delete (delegated on body) ─────────────────────────
  document.body.addEventListener("click", handleEditButtons);
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
  els.recipeModalClose.addEventListener("click", () => { els.recipeModal.close(); resetRecipeFormToAddMode(); });
  els.recipeModal.addEventListener("click", e => { if (e.target === els.recipeModal) { els.recipeModal.close(); resetRecipeFormToAddMode(); } });
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
  els.exportBtn.addEventListener("click", showExportModal);
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
    dbQuery(`SELECT nl.*, r.name AS recipe_name, r.weight_unit
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
    const unit = row.weight_unit || "g";
    const qty  = row.grams != null
      ? `${round(row.grams, 1)} ${unit}`
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

// Converts a decimal minutes value to a compact human-readable string.
// 0.75 → "45s"   1.5 → "1m 30s"   90 → "1h 30m"   60.5 → "1h 0m 30s"
function formatMinutes(decimalMin) {
  const totalSeconds = Math.round(decimalMin * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0 && s === 0) return `${h}h ${m}m`;
  if (h > 0)            return `${h}h ${m}m ${s}s`;
  if (m > 0 && s === 0) return `${m}m`;
  if (m > 0)            return `${m}m ${s}s`;
  return `${s}s`;
}

// Groups consecutive sets with identical (weight, reps) or (duration, reps) and formats a summary line.
// e.g. "3 × 12 reps @55 lb, 1 × 10 reps @50 lb"  /  "2 × 30m"
function summarizeSets(sets, trackingType) {
  if (!sets.length) return null;

  // Stable insertion-order grouping: preserve the order groups first appear.
  const order  = [];
  const groups = new Map();

  for (const s of sets) {
    let key;
    if (trackingType === "weight")      key = `w:${s.weight ?? ""}|r:${s.reps ?? ""}`;
    else if (trackingType === "time")   key = `d:${s.duration_min ?? ""}|r:${s.reps ?? ""}`;
    else                                key = `r:${s.reps ?? ""}`;  // bodyweight

    if (groups.has(key)) {
      groups.get(key).count++;
    } else {
      const g = { count: 1, weight: s.weight, duration_min: s.duration_min, reps: s.reps };
      groups.set(key, g);
      order.push(key);
    }
  }

  return order.map(key => {
    const g = groups.get(key);
    const tokens = [`${g.count} ×`];

    if (trackingType === "weight") {
      if (g.reps    != null) tokens.push(`${g.reps} reps`);
      if (g.weight  != null) tokens.push(`@${round(g.weight, 1)} lb`);
    } else if (trackingType === "time") {
      if (g.duration_min != null) tokens.push(formatMinutes(g.duration_min));
      if (g.reps         != null) tokens.push(`× ${g.reps} reps`);
    } else {
      // bodyweight — reps only
      if (g.reps != null) tokens.push(`${g.reps} reps`);
    }

    return tokens.join(" ") || "—";
  }).join(", ");
}

function renderExerciseList(exercises, setsMap) {
  if (!exercises.length) {
    els.exerciseList.innerHTML = `<div class="empty-state">No exercises logged for this day yet.</div>`;
    return;
  }
  els.exerciseList.innerHTML = exercises.map(row => {
    const sets         = setsMap[row.id] || [];
    const trackingType = row.tracking_type || "weight";

    const summary = summarizeSets(sets, trackingType);
    const extras  = [
      row.category ? escapeHtml(row.category)           : "",
      row.distance ? `${round(row.distance, 2)} km/mi`  : ""
    ].filter(Boolean).join(" · ");

    return `<article class="record">
      <div>
        <h4>${escapeHtml(row.exercise_name)}</h4>
        ${extras  ? `<p class="record-meta">${extras}</p>`                          : ""}
        ${summary ? `<p class="record-meta sets-summary">${escapeHtml(summary)}</p>` : ""}
      </div>
      <div class="record-actions">
        <button class="icon-edit"   type="button" data-edit="exercise"   data-id="${row.id}">Edit</button>
        <button class="icon-danger" type="button" data-delete="exercise" data-id="${row.id}">Delete</button>
      </div>
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
  els.recipeSearchable.setOptions(
    recipes.map(r => ({ value: r.id, label: `${r.name} (${round(r.calories, 0)} kcal/srv)` }))
  );
  if (cur && recipes.some(r => String(r.id) === cur)) els.recipeSearchable.setValue(cur);
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
        <p class="record-meta">${round(r.calories, 0)} kcal · ${round(r.protein, 1)}g P · ${round(r.fat, 1)}g F · ${round(r.carbs, 1)}g C${r.grams_per_serving ? ` · ${r.grams_per_serving}${r.weight_unit || "g"}/srv` : ""}</p>
      </div>
      <div class="record-actions">
        <button class="icon-edit"   type="button" data-edit="recipe"   data-id="${r.id}">Edit</button>
        <button class="icon-danger" type="button" data-delete="recipe" data-id="${r.id}">Delete</button>
      </div>
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
      ex.tracking_type === "time" ? "Time-based" : ex.tracking_type === "bodyweight" ? "Body-weight" : "Weight-based",
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

  els.exerciseSearchable.setOptions(exerciseLibrary.map(e => ({ value: e.id, label: e.name })));
  if (curLib && exerciseLibrary.some(e => String(e.id) === curLib)) els.exerciseSearchable.setValue(curLib);

  els.exerciseProgressSelect.innerHTML = `<option value="">Pick an exercise…</option>` +
    exerciseLibrary.map(e => `<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join("");
  if (curTrend) els.exerciseProgressSelect.value = curTrend;
}

// ─── Nutrition form helpers ───────────────────────────────────────────────────
function nutritionIsCustomToggle() {
  const isCustom = els.nutritionIsCustom.checked;
  els.nutritionRecipeSection.style.display = isCustom ? "none" : "";
  els.nutritionCustomSection.style.display = isCustom ? ""     : "none";
  // Reset quantity toggle and recipe selection
  if (isCustom) els.recipeSearchable.clear();
  selectedRecipe   = null;
  nutritionByWeight = false;
  els.nutritionQtyToggle.style.display = "none";
  els.nutritionServingsRow.style.display = "";
  els.nutritionGramsRow.style.display    = "none";
  els.qtyGramsBtn.textContent = "Grams";
  els.nutritionWeightUnitLabel.textContent = "Grams";
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
    if (allowWeight) {
      const unit = selectedRecipe.weight_unit || "g";
      const label = unit === "ml" ? "Millilitres" : "Grams";
      els.qtyGramsBtn.textContent = unit;
      els.nutritionWeightUnitLabel.textContent = label;
    } else {
      nutritionByWeight = false;
      els.nutritionServingsRow.style.display = "";
      els.nutritionGramsRow.style.display    = "none";
      els.qtyGramsBtn.textContent = "Grams";
      els.nutritionWeightUnitLabel.textContent = "Grams";
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

  if (currentExercise) {
    els.exerciseSetsSection.style.display = "";
    // Hide the "Sets / + Add set" header for exercises that don't track sets
    const header = els.exerciseSetsSection.querySelector(".sets-header");
    if (header) header.style.display = currentExercise.allow_sets_reps ? "" : "none";
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

  const trackingType  = currentExercise?.tracking_type ?? "weight";
  const isTime        = trackingType === "time";
  const isBodyweight  = trackingType === "bodyweight";
  const allowSetsReps = !!currentExercise?.allow_sets_reps;

  let valueField;
  if (isBodyweight) {
    valueField = "";
  } else if (isTime) {
    valueField = `<label>Duration (min)<input type="number" min="0" step="0.01" class="set-duration" /></label>`;
  } else {
    valueField = `<label>Weight (lb)<input type="number" min="0" step="0.5" class="set-weight" /></label>`;
  }

  // Reps: for weight-based (with sets/reps) and bodyweight exercises
  const repsField = ((!isTime && !isBodyweight && allowSetsReps) || isBodyweight)
    ? `<label>Reps<input type="number" min="0" step="1" class="set-reps" /></label>`
    : "";

  // Set label + remove button only when multi-set tracking is on
  const setLabel  = allowSetsReps ? `<span class="set-num">Set ${num}</span>` : "";
  const removeBtn = allowSetsReps
    ? `<button type="button" class="icon-danger remove-set-btn" data-set="${num}"
         style="${setCount <= 1 ? "visibility:hidden" : ""}">×</button>`
    : "";

  div.innerHTML = `${setLabel}${valueField}${repsField}${removeBtn}`;
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
    if (!id) { alert(`Please select a recipe, or check "Custom / one-time entry".`); return; }
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
    els.recipeSearchable.clear();
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
  const sets     = collectSets();

  try {
    const logResult = await dbRun(
      `INSERT INTO exercise_logs (date, exercise_id, exercise_name, category, distance, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [selectedDate, currentExercise.id, currentExercise.name,
       currentExercise.category || "", distance]
    );
    const logId = logResult.lastRowId;

    if (logId && sets.length > 0) {
      await dbBatch(sets.map(s => ({
        sql: `INSERT INTO exercise_sets (log_id, set_number, weight, reps, duration_min) VALUES (?, ?, ?, ?, ?)`,
        params: [logId, s.set_number, s.weight, s.reps, s.duration_min]
      })));
    }

    // Reset form
    els.exerciseSearchable.clear();
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
  const allowWeight     = els.recipeAllowWeight.checked;
  const gramsPerServing = allowWeight ? nullableNumber(els.recipeGramsPerServing.value) : null;
  const weightUnit      = allowWeight ? (els.recipeWeightUnit?.value || "g") : "g";
  const name            = els.recipeName.value.trim();
  const calories = numberOrDefault(els.recipeCalories.value, 0);
  const protein  = numberOrDefault(els.recipeProtein.value,  0);
  const fat      = numberOrDefault(els.recipeFat.value,      0);
  const carbs    = numberOrDefault(els.recipeCarbs.value,    0);

  try {
    if (editingRecipeId) {
      // ── Update existing recipe ─────────────────────────────────
      await dbRun(
        `UPDATE recipes SET name=?, calories=?, protein=?, fat=?, carbs=?,
           allow_weight_logging=?, grams_per_serving=?, weight_unit=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [name, calories, protein, fat, carbs,
         allowWeight ? 1 : 0, gramsPerServing, weightUnit, editingRecipeId]
      );
      // Cascade: recompute macros for every nutrition_log that used this recipe
      await cascadeRecipeUpdate(editingRecipeId, { calories, protein, fat, carbs, grams_per_serving: gramsPerServing });
      resetRecipeFormToAddMode();
    } else {
      // ── Insert new recipe ──────────────────────────────────────
      await dbRun(
        `INSERT INTO recipes (name, calories, protein, fat, carbs, allow_weight_logging, grams_per_serving, weight_unit, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO UPDATE SET
           calories = excluded.calories, protein = excluded.protein,
           fat = excluded.fat, carbs = excluded.carbs,
           allow_weight_logging = excluded.allow_weight_logging,
           grams_per_serving = excluded.grams_per_serving,
           weight_unit = excluded.weight_unit,
           updated_at = CURRENT_TIMESTAMP`,
        [name, calories, protein, fat, carbs,
         allowWeight ? 1 : 0, gramsPerServing, weightUnit]
      );
      els.recipeForm.reset();
      els.recipeGramsPerServingLabel.style.display = "none";
    }
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

// ─── Edit dispatch ────────────────────────────────────────────────────────────
async function handleEditButtons(event) {
  const button = event.target.closest("button[data-edit]");
  if (!button) return;
  const type = button.dataset.edit;
  const id   = Number(button.dataset.id);
  if (type === "recipe")   await handleEditRecipeClick(id);
  if (type === "exercise") await handleEditExerciseClick(id);
}

function resetRecipeFormToAddMode() {
  if (!editingRecipeId) return;
  editingRecipeId = null;
  els.recipeForm.reset();
  els.recipeGramsPerServingLabel.style.display = "none";
  els.recipeForm.querySelector("button[type=submit]").textContent = "Save recipe";
}

async function handleEditRecipeClick(id) {
  const recipe = await dbOne("SELECT * FROM recipes WHERE id = ?", [id]);
  if (!recipe) return;

  editingRecipeId = id;

  // Pre-fill the add form at the top of the modal
  els.recipeName.value     = recipe.name;
  els.recipeCalories.value = recipe.calories;
  els.recipeProtein.value  = recipe.protein;
  els.recipeCarbs.value    = recipe.carbs;
  els.recipeFat.value      = recipe.fat;
  els.recipeAllowWeight.checked = !!recipe.allow_weight_logging;
  els.recipeGramsPerServingLabel.style.display = recipe.allow_weight_logging ? "" : "none";
  if (recipe.grams_per_serving != null) els.recipeGramsPerServing.value = recipe.grams_per_serving;
  if (els.recipeWeightUnit) els.recipeWeightUnit.value = recipe.weight_unit || "g";

  els.recipeForm.querySelector("button[type=submit]").textContent = "Update recipe";
  els.recipeModal.scrollTop = 0;
  els.recipeName.focus();
}

async function cascadeRecipeUpdate(recipeId, recipe) {
  const logs = await dbQuery(
    "SELECT id, servings, grams, date FROM nutrition_logs WHERE recipe_id = ?",
    [recipeId]
  );
  if (!logs.length) return;

  const updates = logs.map(log => {
    let s = Number(log.servings) || 1;
    // If logged by weight, derive servings from grams
    if (log.grams != null && recipe.grams_per_serving) {
      s = Number(log.grams) / Number(recipe.grams_per_serving);
    }
    return {
      sql: `UPDATE nutrition_logs SET calories=?, protein=?, fat=?, carbs=? WHERE id=?`,
      params: [recipe.calories * s, recipe.protein * s, recipe.fat * s, recipe.carbs * s, log.id]
    };
  });
  await dbBatch(updates);

  // Recalculate daily totals for every affected date
  const dates = [...new Set(logs.map(l => l.date))];
  for (const date of dates) await recalculateDailyNutrition(date);
}

async function handleEditExerciseClick(logId) {
  const [log, existingSets] = await Promise.all([
    dbOne(`SELECT el.*, e.tracking_type, e.allow_sets_reps, e.allow_distance
           FROM exercise_logs el
           LEFT JOIN exercises e ON e.id = el.exercise_id
           WHERE el.id = ?`, [logId]),
    dbQuery("SELECT * FROM exercise_sets WHERE log_id = ? ORDER BY set_number", [logId])
  ]);
  if (!log) return;

  const trackingType  = log.tracking_type  || "weight";
  const allowSetsReps = !!log.allow_sets_reps;
  const allowDistance = !!log.allow_distance;
  let editSetCount    = 0;

  // Build modal
  const modal = document.createElement("dialog");
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Edit: ${escapeHtml(log.exercise_name)}</h2>
      <button type="button" class="modal-close" id="exerciseEditClose">✕</button>
    </div>
    <form id="exerciseEditForm" class="grid-form">
      <div class="full-width">
        ${allowSetsReps ? `
          <div class="sets-header">
            <span class="sets-label">Sets</span>
            <button type="button" id="editAddSetBtn" class="secondary">+ Add set</button>
          </div>` : ""}
        <div id="editSetRows" class="set-rows"></div>
      </div>
      ${allowDistance ? `
        <label>Distance (km / mi)
          <input id="editDistance" type="number" min="0" step="0.01"
            value="${log.distance != null ? log.distance : ""}" />
        </label>` : ""}
      <button type="submit" class="full-width">Save changes</button>
    </form>`;
  document.body.appendChild(modal);
  modal.showModal();

  const closeModal = () => { modal.close(); modal.remove(); };
  modal.querySelector("#exerciseEditClose").addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

  if (!allowSetsReps) {
    // Single-entry edit (no set tracking): show one row with just the value field
    const container = modal.querySelector("#editSetRows");
    const existing  = existingSets[0] ?? null;
    const isTime       = trackingType === "time";
    const isBodyweight = trackingType === "bodyweight";
    let fieldHtml;
    if (isBodyweight) {
      fieldHtml = `<label>Reps<input type="number" min="0" step="1" class="set-reps" value="${existing?.reps ?? ""}"/></label>`;
    } else if (isTime) {
      fieldHtml = `<label>Duration (min)<input type="number" min="0" step="0.01" class="set-duration" value="${existing?.duration_min ?? ""}"/></label>`;
    } else {
      fieldHtml = `<label>Weight (lb)<input type="number" min="0" step="0.5" class="set-weight" value="${existing?.weight ?? ""}"/></label>`;
    }
    const div = document.createElement("div");
    div.className      = "set-row";
    div.dataset.setNum = "1";
    div.innerHTML      = fieldHtml;
    container.appendChild(div);
  }

  if (allowSetsReps) {
    const container = modal.querySelector("#editSetRows");

    const buildRow = (num, set = null) => {
      const div = document.createElement("div");
      div.className      = "set-row";
      div.dataset.setNum = String(num);

      const isTime       = trackingType === "time";
      const isBodyweight = trackingType === "bodyweight";

      let valField;
      if (isBodyweight) {
        valField = "";
      } else if (isTime) {
        valField = `<label>Duration (min)<input type="number" min="0" step="0.01" class="set-duration" value="${set?.duration_min ?? ""}"/></label>`;
      } else {
        valField = `<label>Weight (lb)<input type="number" min="0" step="0.5" class="set-weight" value="${set?.weight ?? ""}"/></label>`;
      }

      const repsField = ((!isTime && !isBodyweight && allowSetsReps) || isBodyweight)
        ? `<label>Reps<input type="number" min="0" step="1" class="set-reps" value="${set?.reps ?? ""}"/></label>`
        : "";

      const setLabel  = allowSetsReps ? `<span class="set-num">Set ${num}</span>` : "";
      const removeBtn = allowSetsReps
        ? `<button type="button" class="icon-danger remove-set-btn" data-set="${num}">×</button>`
        : "";

      div.innerHTML = `${setLabel}${valField}${repsField}${removeBtn}`;
      return div;
    };

    const refreshRemoveVisibility = () => {
      const rows = container.querySelectorAll(".set-row");
      rows.forEach(r => {
        r.querySelector(".remove-set-btn").style.visibility = rows.length <= 1 ? "hidden" : "";
      });
    };

    // Keep both data-set-num (on the row) and data-set (on the remove btn) in sync.
    const renumberRows = () => {
      editSetCount = 0;
      container.querySelectorAll(".set-row").forEach(r => {
        editSetCount++;
        r.dataset.setNum = String(editSetCount);           // data-set-num on the row
        r.querySelector(".set-num").textContent = `Set ${editSetCount}`;
        r.querySelector(".remove-set-btn").dataset.set = String(editSetCount); // data-set on btn
      });
      refreshRemoveVisibility();
    };

    // Populate with existing sets (or one blank row)
    const seed = existingSets.length ? existingSets : [null];
    seed.forEach((s, i) => { editSetCount++; container.appendChild(buildRow(i + 1, s)); });
    refreshRemoveVisibility();

    modal.querySelector("#editAddSetBtn").addEventListener("click", () => {
      editSetCount++;
      container.appendChild(buildRow(editSetCount));
      refreshRemoveVisibility();
    });

    container.addEventListener("click", e => {
      const btn = e.target.closest(".remove-set-btn");
      if (!btn) return;
      // btn.dataset.set holds the set number; match against the row's data-set-num
      container.querySelector(`.set-row[data-set-num="${btn.dataset.set}"]`)?.remove();
      renumberRows();
    });
  }

  modal.querySelector("#exerciseEditForm").addEventListener("submit", async e => {
    e.preventDefault();
    const newSets = [];
    modal.querySelectorAll("#editSetRows .set-row").forEach((row, idx) => {
      newSets.push({
        set_number:   idx + 1,
        weight:       nullableNumber(row.querySelector(".set-weight")?.value),
        duration_min: nullableNumber(row.querySelector(".set-duration")?.value),
        reps:         nullableInt(row.querySelector(".set-reps")?.value)
      });
    });
    const distance = allowDistance
      ? nullableNumber(modal.querySelector("#editDistance")?.value)
      : log.distance;

    try {
      await dbBatch([
        { sql: "DELETE FROM exercise_sets WHERE log_id = ?", params: [logId] },
        ...newSets.map(s => ({
          sql: "INSERT INTO exercise_sets (log_id, set_number, weight, reps, duration_min) VALUES (?, ?, ?, ?, ?)",
          params: [logId, s.set_number, s.weight, s.reps, s.duration_min]
        })),
        { sql: "UPDATE exercise_logs SET distance=? WHERE id=?", params: [distance, logId] }
      ]);
      closeModal();
      setStatus("Saved");
      await renderSelectedDate();
    } catch (err) {
      console.error(err);
      setStatus("Save failed", true);
    }
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────
function showExportModal() {
  const today = formatDateKey(new Date());
  const thirtyAgo = formatDateKey(new Date(Date.now() - 29 * 864e5));

  const modal = document.createElement("dialog");
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Export Logs</h2>
      <button type="button" class="modal-close" id="exportModalClose">✕</button>
    </div>
    <form id="exportForm" class="grid-form">
      <label>From
        <input type="date" id="exportFrom" value="${thirtyAgo}" required />
      </label>
      <label>To
        <input type="date" id="exportTo" value="${today}" required />
      </label>
      <button type="submit" class="full-width">Download .md file</button>
    </form>`;
  document.body.appendChild(modal);
  modal.showModal();

  const close = () => { modal.close(); modal.remove(); };
  modal.querySelector("#exportModalClose").addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  modal.querySelector("#exportForm").addEventListener("submit", async e => {
    e.preventDefault();
    const from = modal.querySelector("#exportFrom").value;
    const to   = modal.querySelector("#exportTo").value;
    if (!from || !to) return;
    close();
    await handleExport(from, to);
  });
}

async function handleExport(from, to) {
  setStatus("Exporting…");
  try {
    const [exerciseRows, nutritionRows, dailyRows, sleepRows, bodyRows] = await Promise.all([
      dbQuery(`
        SELECT el.date, el.id AS log_id, el.exercise_name,
               COALESCE(e.tracking_type, 'weight') AS tracking_type,
               es.set_number, es.weight, es.reps, es.duration_min
        FROM exercise_logs el
        LEFT JOIN exercises e ON e.id = el.exercise_id
        LEFT JOIN exercise_sets es ON es.log_id = el.id
        WHERE el.date >= ? AND el.date <= ?
        ORDER BY el.date, el.id, es.set_number`, [from, to]),
      dbQuery(`
        SELECT nl.date, nl.meal_type,
               COALESCE(r.name, nl.custom_name) AS food_name,
               nl.calories, nl.protein, nl.fat, nl.carbs
        FROM nutrition_logs nl
        LEFT JOIN recipes r ON r.id = nl.recipe_id
        WHERE nl.date >= ? AND nl.date <= ?
        ORDER BY nl.date,
          CASE nl.meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2
            WHEN 'dinner' THEN 3 ELSE 4 END`, [from, to]),
      dbQuery(`SELECT date, calories, protein, fat, carbs FROM daily_nutrition
               WHERE date >= ? AND date <= ? ORDER BY date`, [from, to]),
      dbQuery(`SELECT date, hours FROM sleep_logs
               WHERE date >= ? AND date <= ? ORDER BY date`, [from, to]),
      dbQuery(`SELECT date, weight, waist FROM body_measurements
               WHERE date >= ? AND date <= ? ORDER BY date`, [from, to]),
    ]);

    const md = formatExportMarkdown({ exerciseRows, nutritionRows, dailyRows, sleepRows, bodyRows }, from, to);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fitness-export-${from}-to-${to}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Exported");
  } catch (err) {
    console.error(err);
    setStatus("Export failed", true);
  }
}

function formatExportMarkdown({ exerciseRows, nutritionRows, dailyRows, sleepRows, bodyRows }, from, to) {
  const lines = [`# Fitness Log Export: ${from} to ${to}`, ""];

  // Collect all unique dates across all data types
  const allDates = [...new Set([
    ...exerciseRows.map(r => r.date),
    ...nutritionRows.map(r => r.date),
    ...sleepRows.map(r => r.date),
    ...bodyRows.map(r => r.date),
  ])].sort();

  // Index daily totals by date
  const dailyByDate = Object.fromEntries(dailyRows.map(r => [r.date, r]));

  for (const date of allDates) {
    lines.push(`## ${date}`, "");

    // ── Exercise ──
    const exLogs = exerciseRows.filter(r => r.date === date);
    if (exLogs.length) {
      lines.push("### Exercise");
      // Group rows by log_id
      const byLog = new Map();
      for (const r of exLogs) {
        if (!byLog.has(r.log_id)) byLog.set(r.log_id, { name: r.exercise_name, tracking_type: r.tracking_type, sets: [] });
        if (r.set_number != null) byLog.get(r.log_id).sets.push(r);
      }
      for (const { name, tracking_type, sets } of byLog.values()) {
        const summary = sets.length ? summarizeSets(sets, tracking_type) : "logged";
        lines.push(`- ${name} (${tracking_type}): ${summary}`);
      }
      lines.push("");
    }

    // ── Meals ──
    const meals = nutritionRows.filter(r => r.date === date);
    if (meals.length) {
      lines.push("### Meals");
      for (const m of meals) {
        const cal  = round(m.calories  ?? 0, 0);
        const pro  = round(m.protein   ?? 0, 1);
        const carb = round(m.carbs     ?? 0, 1);
        const fat  = round(m.fat       ?? 0, 1);
        lines.push(`- ${m.meal_type.charAt(0).toUpperCase() + m.meal_type.slice(1)}: ${m.food_name} — ${cal} cal | ${pro}g protein | ${carb}g carbs | ${fat}g fat`);
      }
      const daily = dailyByDate[date];
      if (daily) {
        lines.push(`- **Daily Total: ${round(daily.calories ?? 0, 0)} cal | ${round(daily.protein ?? 0, 1)}g protein | ${round(daily.carbs ?? 0, 1)}g carbs | ${round(daily.fat ?? 0, 1)}g fat**`);
      }
      lines.push("");
    }

    // ── Sleep ──
    const sleepEntry = sleepRows.find(r => r.date === date);
    if (sleepEntry) {
      lines.push("### Sleep");
      lines.push(`- ${sleepEntry.hours} hours`);
      lines.push("");
    }

    // ── Body ──
    const bodyEntry = bodyRows.find(r => r.date === date);
    if (bodyEntry) {
      lines.push("### Body");
      const parts = [];
      if (bodyEntry.weight != null) parts.push(`Weight: ${bodyEntry.weight} lb`);
      if (bodyEntry.waist  != null) parts.push(`Waist: ${bodyEntry.waist} in`);
      if (parts.length) lines.push(`- ${parts.join(" | ")}`);
      lines.push("");
    }
  }

  if (!allDates.length) lines.push("No data found for this date range.", "");
  return lines.join("\n");
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
      sqLogId = r.lastRowId;
    }
    if (walk) {
      const r = await dbRun(
        `INSERT INTO exercise_logs (date, exercise_id, exercise_name, category, distance) VALUES (?, ?, ?, ?, 1.2)`,
        [today, walk.id, walk.name, walk.category || "Cardio"]
      );
      walkLogId = r.lastRowId;
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

  const [nutRows, sleepRows, bodyRows] = await Promise.all([
    dbQuery("SELECT date, calories, protein, fat, carbs FROM daily_nutrition WHERE date >= ? AND date <= ? ORDER BY date", [startDate, todayKey]),
    dbQuery("SELECT date, hours FROM sleep_logs WHERE date >= ? AND date <= ? ORDER BY date", [startDate, todayKey]),
    dbQuery("SELECT date, weight, waist FROM body_measurements WHERE date >= ? AND date <= ? ORDER BY date", [startDate, todayKey])
  ]);

  const spine = buildDateSpine(startDate, todayKey);

  const charts = [
    { label: "Calories",         color: "#f78166", rows: nutRows,   key: "calories", unit: " kcal" },
    { label: "Sleep (hours)",    color: "#79c0ff", rows: sleepRows, key: "hours",    unit: "h" },
    { label: "Body Weight (lb)", color: "#e3b341", rows: bodyRows,  key: "weight",   unit: " lb" },
    { label: "Waist (in)",       color: "#d2a8ff", rows: bodyRows,  key: "waist",    unit: " in" },
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

  // Stacked macros bar chart
  const macroCard = document.createElement("div");
  macroCard.className = "chart-card";
  macroCard.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem">
      <h3>Macros (g)</h3>
      <div style="display:flex;gap:0.75rem;font-size:0.72rem">
        <span style="color:#f78166">■ Carbs</span>
        <span style="color:#7ee787">■ Protein</span>
        <span style="color:#e3b341">■ Fat</span>
      </div>
    </div>
    <div id="chart-macros"></div>`;
  els.chartsGrid.appendChild(macroCard);
  const macroData = spine.map(d => {
    const row = nutRows.find(r => r.date === d);
    return { date: d, carbs: row?.carbs ?? null, protein: row?.protein ?? null, fat: row?.fat ?? null };
  });
  renderStackedBarChart(macroCard.querySelector("#chart-macros"), macroData);

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

  const exercise      = exerciseLibrary.find(e => e.name === exerciseName);
  const trackingType  = exercise?.tracking_type ?? "weight";
  const isTime        = trackingType === "time";
  const isBodyweight  = trackingType === "bodyweight";
  const todayKey      = formatDateKey(new Date());
  const startDate     = dateSpineStart(todayKey, trendDays);

  // One row per unique (date × weight/duration/reps) — multiple dots can appear per day
  const groupBy = isBodyweight ? "el.date, es.reps" : "el.date, es.weight, es.duration_min";
  const rows = await dbQuery(`
    SELECT el.date,
      es.weight,
      es.duration_min,
      es.reps                   AS reps_val,
      COUNT(es.id)              AS set_count,
      SUM(COALESCE(es.reps, 0)) AS total_reps
    FROM exercise_logs el
    JOIN exercise_sets es ON es.log_id = el.id
    WHERE el.exercise_name = ? AND el.date >= ? AND el.date <= ?
    GROUP BY ${groupBy}
    ORDER BY el.date`,
    [exerciseName, startDate, todayKey]);

  if (!rows.length) {
    els.exerciseProgressChart.innerHTML = `<div class="chart-empty">No data for this period.</div>`;
    return;
  }

  renderDotChart(els.exerciseProgressChart, rows, { isTime, isBodyweight });
}

function renderDotChart(container, rows, { isTime = false, isBodyweight = false } = {}) {
  const W   = 480, H = 220;
  const pad = { t: 16, r: 16, b: 32, l: 52 };
  const cW  = W - pad.l - pad.r;
  const cH  = H - pad.t - pad.b;

  // Unique sorted dates → x positions
  const allDates  = [...new Set(rows.map(r => r.date))].sort();
  const N         = allDates.length;
  const dateIndex = Object.fromEntries(allDates.map((d, i) => [d, i]));

  // Y axis range
  const yVals = rows.map(r => Number(isBodyweight ? r.reps_val : isTime ? r.duration_min : r.weight)).filter(v => isFinite(v));
  let minV = Math.min(...yVals), maxV = Math.max(...yVals);
  if (minV === maxV) { minV = Math.max(0, minV - 5); maxV += 5; }

  // Intensity: normalise set count (time/bodyweight) or total reps (weight-based) → opacity 0.2–1.0
  const intensityKey = (isTime || isBodyweight) ? "set_count" : "total_reps";
  const maxIntensity = Math.max(...rows.map(r => Number(r[intensityKey]) || 0), 1);

  const sx = i  => pad.l + (N < 2 ? cW / 2 : (i / (N - 1)) * cW);
  const sy = v  => pad.t + cH - ((v - minV) / (maxV - minV)) * cH;
  const f  = n  => n.toFixed(1);

  // Y-axis ticks (5 levels)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const v = minV + t * (maxV - minV);
    const y = sy(v);
    const label = isBodyweight ? `${round(v, 0)} reps` : isTime ? formatMinutes(v) : `${round(v, 0)}`;
    return `<line x1="${pad.l}" y1="${f(y)}" x2="${f(pad.l + cW)}" y2="${f(y)}" class="chart-grid"/>
            <text x="${f(pad.l - 6)}" y="${f(y + 4)}" class="chart-tick" text-anchor="end">${label}</text>`;
  }).join("");

  // X-axis date labels (up to 5)
  const xCount = Math.min(5, N);
  const xIdxs  = xCount <= 1 ? [0] : Array.from({ length: xCount }, (_, i) =>
    Math.round(i * (N - 1) / (xCount - 1)));
  const xTicks = [...new Set(xIdxs)].map(i =>
    `<text x="${f(sx(i))}" y="${H - 4}" class="chart-tick" text-anchor="middle">${allDates[i].slice(5).replace("-", "/")}</text>`
  ).join("");

  // Dots — one per row, opacity encodes intensity
  const dots = rows.map((r, ri) => {
    const yVal = Number(isBodyweight ? r.reps_val : isTime ? r.duration_min : r.weight);
    if (!isFinite(yVal)) return "";
    const cx      = sx(dateIndex[r.date]);
    const cy      = sy(yVal);
    const opacity = (0.2 + 0.8 * ((Number(r[intensityKey]) || 0) / maxIntensity)).toFixed(2);
    const sc      = Number(r.set_count);
    const rp      = Number(r.total_reps);
    const yLabel  = isBodyweight ? `${round(yVal, 0)} reps` : isTime ? formatMinutes(yVal) : `${round(yVal, 1)} lb`;
    const tipText = isBodyweight
      ? `${r.date} · ${yLabel} · ${sc} set${sc !== 1 ? "s" : ""}`
      : isTime
        ? `${r.date} · ${yLabel} · ${sc} set${sc !== 1 ? "s" : ""}`
        : `${r.date} · ${yLabel} · ${rp} rep${rp !== 1 ? "s" : ""} across ${sc} set${sc !== 1 ? "s" : ""}`;

    return `<circle cx="${f(cx)}" cy="${f(cy)}" r="5.5"
              fill="#58a6ff" fill-opacity="${opacity}"
              stroke="#58a6ff" stroke-opacity="${Math.min(1, Number(opacity) + 0.15).toFixed(2)}"
              stroke-width="1.5"
              data-tip="${escapeHtml(tipText)}"
              class="dot-point"/>`;
  }).join("");

  container.innerHTML = `
    <div class="dot-chart-wrap" style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" class="line-chart">
        ${yTicks}
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${f(pad.t + cH)}" class="chart-axis"/>
        <line x1="${pad.l}" y1="${f(pad.t + cH)}" x2="${f(pad.l + cW)}" y2="${f(pad.t + cH)}" class="chart-axis"/>
        ${dots}
        ${xTicks}
      </svg>
      <div class="dot-tooltip" id="dotTooltip" style="display:none"></div>
    </div>`;

  // Wire up hover tooltip
  const svg     = container.querySelector("svg");
  const tooltip = container.querySelector("#dotTooltip");
  svg.addEventListener("mouseover", e => {
    const circle = e.target.closest(".dot-point");
    if (!circle) return;
    tooltip.textContent = circle.dataset.tip;
    tooltip.style.display = "block";
  });
  svg.addEventListener("mousemove", e => {
    const rect = container.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - rect.left + 12}px`;
    tooltip.style.top  = `${e.clientY - rect.top  - 28}px`;
  });
  svg.addEventListener("mouseout", e => {
    if (!e.target.closest(".dot-point")) return;
    tooltip.style.display = "none";
  });
}

// ─── Stacked bar chart (macros) ───────────────────────────────────────────────
function renderStackedBarChart(container, points) {
  // points: [{ date, carbs, protein, fat }]
  const nonNull = points.filter(p => p.carbs !== null || p.protein !== null || p.fat !== null);
  if (!nonNull.length) {
    container.innerHTML = `<div class="chart-empty">No data for this period</div>`;
    return;
  }

  const W = 480, H = 140;
  const pad = { t: 14, r: 12, b: 28, l: 44 };
  const cW  = W - pad.l - pad.r;
  const cH  = H - pad.t - pad.b;
  const N   = points.length;
  const f   = n => n.toFixed(1);

  const maxTotal = Math.max(...nonNull.map(p => (p.carbs ?? 0) + (p.protein ?? 0) + (p.fat ?? 0)), 1);
  const sy = v => pad.t + cH - (v / maxTotal) * cH;

  const slotW = cW / N;
  const barW  = Math.max(2, slotW * 0.72);
  const barX  = i => pad.l + i * slotW + (slotW - barW) / 2;

  const yTicks = [0, 0.5, 1].map(t => {
    const v = t * maxTotal, y = sy(v);
    return `<line x1="${pad.l}" y1="${f(y)}" x2="${f(pad.l + cW)}" y2="${f(y)}" class="chart-grid"/>
            <text x="${f(pad.l - 4)}" y="${f(y + 4)}" class="chart-tick" text-anchor="end">${round(v, 0)}</text>`;
  }).join("");

  const xCount = Math.min(5, N);
  const xIdxs  = xCount <= 1 ? [0] : Array.from({ length: xCount }, (_, i) =>
    Math.min(Math.round(i * (N - 1) / (xCount - 1)), N - 1));
  const xTicks = [...new Set(xIdxs)].map(i =>
    `<text x="${f(barX(i) + barW / 2)}" y="${H - 4}" class="chart-tick" text-anchor="middle">${points[i].date.slice(5).replace("-", "/")}</text>`
  ).join("");

  const COLORS = { carbs: "#f78166", protein: "#7ee787", fat: "#e3b341" };
  const baseY  = pad.t + cH;

  const bars = points.map((p, i) => {
    if (p.carbs === null && p.protein === null && p.fat === null) return "";
    const carbs = p.carbs ?? 0, protein = p.protein ?? 0, fat = p.fat ?? 0;
    const total = carbs + protein + fat;
    const x = barX(i);
    const tip = `data-date="${p.date}" data-carbs="${round(carbs,1)}" data-protein="${round(protein,1)}" data-fat="${round(fat,1)}" data-total="${round(total,1)}"`;
    let y = baseY;
    return [["carbs", carbs], ["protein", protein], ["fat", fat]].map(([key, val]) => {
      if (val <= 0) return "";
      const h = (val / maxTotal) * cH;
      y -= h;
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(barW)}" height="${f(h)}" fill="${COLORS[key]}" ${tip} class="bar-segment"/>`;
    }).join("");
  }).join("");

  container.innerHTML = `
    <div class="dot-chart-wrap" style="position:relative">
      <svg viewBox="0 0 ${W} ${H}" class="line-chart">
        ${yTicks}
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${f(pad.t + cH)}" class="chart-axis"/>
        <line x1="${pad.l}" y1="${f(baseY)}" x2="${f(pad.l + cW)}" y2="${f(baseY)}" class="chart-axis"/>
        ${bars}
        ${xTicks}
      </svg>
      <div class="dot-tooltip" id="macroTooltip" style="display:none"></div>
    </div>`;

  const svg     = container.querySelector("svg");
  const tooltip = container.querySelector("#macroTooltip");
  svg.addEventListener("mouseover", e => {
    const seg = e.target.closest(".bar-segment");
    if (!seg) return;
    const { date, carbs, protein, fat, total } = seg.dataset;
    tooltip.innerHTML = `${date}<br>Carbs: ${carbs}g &nbsp;·&nbsp; Protein: ${protein}g &nbsp;·&nbsp; Fat: ${fat}g<br>Total: ${total}g`;
    tooltip.style.display = "block";
  });
  svg.addEventListener("mousemove", e => {
    const rect = container.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - rect.left + 12}px`;
    tooltip.style.top  = `${e.clientY - rect.top  - 52}px`;
  });
  svg.addEventListener("mouseout", e => {
    if (!e.target.closest(".bar-segment")) return;
    tooltip.style.display = "none";
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

// ─── SearchableSelect ─────────────────────────────────────────────────────────
// Replaces a native <select> with a filterable text input + floating list.
// The backing <input type="hidden"> keeps the value and fires "change" events
// so all existing event listeners require zero changes.
class SearchableSelect {
  constructor(hostEl, hiddenEl, { placeholder = "Search…" } = {}) {
    this._host   = typeof hostEl   === "string" ? document.getElementById(hostEl)   : hostEl;
    this._hidden = typeof hiddenEl === "string" ? document.getElementById(hiddenEl) : hiddenEl;
    this._options  = [];   // [{value, label}]
    this._matches  = [];   // filtered subset currently rendered
    this._selected = null; // {value, label} | null
    this._focusIdx = -1;
    this._isOpen   = false;

    this._input = Object.assign(document.createElement("input"), {
      type: "text", className: "searchable-input",
      placeholder, autocomplete: "off", spellcheck: false
    });
    this._list = Object.assign(document.createElement("div"), {
      className: "searchable-dropdown"
    });

    this._host.appendChild(this._input);
    this._host.appendChild(this._list);
    this._bind();
  }

  /** Replace the full option list. Deselects if the current value is gone. */
  setOptions(options) {
    this._options = options;
    if (this._selected && !options.some(o => String(o.value) === String(this._selected.value))) {
      this._selected = null;
      this._hidden.value = "";
      this._input.value  = "";
    }
    if (this._isOpen) this._renderList(this._input.value);
  }

  getValue() { return this._hidden.value; }

  setValue(value) {
    const opt = this._options.find(o => String(o.value) === String(value));
    this._selected     = opt || null;
    this._hidden.value = opt ? String(opt.value) : "";
    this._input.value  = opt ? opt.label : "";
  }

  clear() {
    this._selected     = null;
    this._hidden.value = "";
    this._input.value  = "";
    if (this._isOpen) this._close();
  }

  _renderList(filter) {
    const q = (filter || "").toLowerCase().trim();
    this._matches  = q ? this._options.filter(o => o.label.toLowerCase().includes(q)) : this._options;
    this._focusIdx = -1;
    if (!this._matches.length) {
      this._list.innerHTML = `<div class="searchable-empty">No matches</div>`;
    } else {
      this._list.innerHTML = this._matches.map((o, i) => {
        const cls = "searchable-option" +
          (this._selected && String(o.value) === String(this._selected.value) ? " selected" : "");
        return `<div class="${cls}" data-value="${escapeHtml(String(o.value))}" data-i="${i}">${escapeHtml(o.label)}</div>`;
      }).join("");
    }
  }

  _open() {
    if (this._isOpen) return;
    this._isOpen = true;
    this._renderList(this._selected ? "" : this._input.value);
    this._list.classList.add("open");
    const sel = this._list.querySelector(".selected");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }

  _close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._list.classList.remove("open");
    this._input.value = this._selected ? this._selected.label : "";
  }

  _pick(value) {
    const opt = this._matches.find(o => String(o.value) === String(value));
    if (!opt) return;
    const prev = this._hidden.value;
    this._selected     = opt;
    this._hidden.value = String(opt.value);
    this._close();
    if (prev !== this._hidden.value) {
      this._hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  _moveFocus(dir) {
    const items = Array.from(this._list.querySelectorAll(".searchable-option"));
    if (!items.length) return;
    this._focusIdx = Math.max(0, Math.min(items.length - 1, this._focusIdx + dir));
    items.forEach((el, i) => el.classList.toggle("focused", i === this._focusIdx));
    items[this._focusIdx]?.scrollIntoView({ block: "nearest" });
  }

  _bind() {
    this._input.addEventListener("focus", () => {
      if (this._selected) this._input.value = ""; // clear text to enable search
      this._open();
    });

    this._input.addEventListener("input", () => {
      // Typing clears any existing selection
      if (this._selected) {
        const prev = this._hidden.value;
        this._selected     = null;
        this._hidden.value = "";
        if (prev) this._hidden.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (!this._isOpen) { this._isOpen = true; this._list.classList.add("open"); }
      this._renderList(this._input.value);
    });

    this._input.addEventListener("blur", () => {
      // Small delay so a click on an option registers first
      setTimeout(() => { if (!this._host.contains(document.activeElement)) this._close(); }, 150);
    });

    this._list.addEventListener("mousedown", e => {
      e.preventDefault(); // prevent blur before click
      const opt = e.target.closest(".searchable-option");
      if (opt) this._pick(opt.dataset.value);
    });

    this._input.addEventListener("keydown", e => {
      if (!this._isOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
        e.preventDefault(); this._open(); return;
      }
      if      (e.key === "ArrowDown") { e.preventDefault(); this._moveFocus(1); }
      else if (e.key === "ArrowUp")   { e.preventDefault(); this._moveFocus(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const items = Array.from(this._list.querySelectorAll(".searchable-option"));
        if (this._focusIdx >= 0 && items[this._focusIdx]) this._pick(items[this._focusIdx].dataset.value);
      }
      else if (e.key === "Escape") { this._close(); this._input.blur(); }
    });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
