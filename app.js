// ─── Config keys (localStorage) ─────────────────────────────────────────────
const WORKER_URL_KEY = "fitness_tracker_worker_url";
const AUTH_TOKEN_KEY = "fitness_tracker_auth_token";

// ─── App state ───────────────────────────────────────────────────────────────
let workerUrl;
let authToken;
let currentMonth;
let selectedDate;
let activeView = "nutrition";

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
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Connection failed — check settings", true);
  }
}

// ─── Config modal ────────────────────────────────────────────────────────────
function showConfigModal() {
  injectModalStyles();
  document.getElementById("configModal")?.remove();

  const modal = document.createElement("dialog");
  modal.id = "configModal";
  modal.innerHTML = `
    <form id="configForm">
      <h2>Connect to your Worker</h2>
      <p>Your Cloudflare Worker URL and auth token are saved in this browser only.</p>
      <label>Worker URL
        <input id="configWorkerUrl" type="url"
          placeholder="https://fitness-tracker-api.xxx.workers.dev"
          value="${escapeHtml(workerUrl)}" required />
      </label>
      <label>Auth Token
        <input id="configAuthToken" type="password"
          placeholder="your-secret-token"
          value="${escapeHtml(authToken)}" required />
      </label>
      <p id="configError" class="status warn" style="display:none"></p>
      <div class="config-actions">
        <button type="submit" id="configSubmitBtn">Connect</button>
        ${workerUrl ? `<button type="button" id="configCancelBtn">Cancel</button>` : ""}
      </div>
    </form>
  `;
  document.body.appendChild(modal);
  modal.showModal();

  modal.querySelector("#configCancelBtn")?.addEventListener("click", () => {
    modal.close();
    modal.remove();
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
      modal.close();
      modal.remove();
      await initApp();
    } catch (err) {
      errEl.textContent = `Could not connect: ${err.message}. Check your URL and token.`;
      errEl.style.display = "";
      submitBtn.disabled = false;
      submitBtn.textContent = "Connect";
    }
  });
}

function injectModalStyles() {
  if (document.getElementById("configModalStyles")) return;
  const style = document.createElement("style");
  style.id = "configModalStyles";
  style.textContent = `
    #configModal {
      border: none; border-radius: 8px; padding: 2rem;
      max-width: 480px; width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
    }
    #configModal::backdrop { background: rgba(0,0,0,0.5); }
    #configModal h2 { margin-top: 0; }
    #configModal p { margin-top: 0; }
    #configModal label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 1rem; font-weight: 500; }
    #configModal input { padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; font-weight: normal; }
    .config-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 1rem; }
  `;
  document.head.appendChild(style);
}

// ─── Worker API layer ────────────────────────────────────────────────────────
async function dbFetch(path, body) {
  const res = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// SELECT — returns array of row objects
async function dbQuery(sql, params = []) {
  const data = await dbFetch("/query", { sql, params });
  return data.rows ?? [];
}

// SELECT — returns first row or null
async function dbOne(sql, params = []) {
  return (await dbQuery(sql, params))[0] ?? null;
}

// INSERT / UPDATE / DELETE — returns { success, changes, lastRowId }
async function dbRun(sql, params = []) {
  return dbFetch("/run", { sql, params });
}

// Multiple statements in one transaction — takes array of { sql, params? }
async function dbBatch(statements) {
  return dbFetch("/batch", { statements });
}

// ─── Element cache ───────────────────────────────────────────────────────────
function cacheElements() {
  const ids = [
    "settingsBtn", "sampleDataBtn", "prevMonthBtn", "nextMonthBtn", "todayBtn",
    "monthLabel", "calendar", "legend", "selectedDateHeading", "dbStatus", "summaryCards",
    "nutritionForm", "mealType", "recipeSelect", "nutritionName", "servings",
    "mealCalories", "mealProtein", "mealFat", "mealCarbs", "nutritionNotes", "nutritionList",
    "sleepForm", "sleepHours", "sleepQuality", "sleepNotes", "sleepList",
    "exerciseForm", "exerciseName", "exerciseCategory", "exerciseSets", "exerciseReps",
    "exerciseWeight", "exerciseDuration", "exerciseDistance", "exerciseNotes", "exerciseList",
    "recipeForm", "recipeName", "recipeServingSize", "recipeCalories", "recipeProtein",
    "recipeFat", "recipeCarbs", "recipeNotes", "recipeList"
  ];
  ids.forEach(id => { els[id] = document.getElementById(id); });
  els.viewButtons = Array.from(document.querySelectorAll(".view-btn"));
  els.tabButtons  = Array.from(document.querySelectorAll(".tab-btn"));
  els.tabSections = Array.from(document.querySelectorAll(".tab-section"));
}

function setInitialDates() {
  const today = new Date();
  currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

// ─── Event binding ───────────────────────────────────────────────────────────
function bindEvents() {
  els.prevMonthBtn.addEventListener("click", async () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    await renderCalendar();
  });

  els.nextMonthBtn.addEventListener("click", async () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    await renderCalendar();
  });

  els.todayBtn.addEventListener("click", async () => {
    const today = new Date();
    currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDate = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
    await renderAll();
  });

  els.viewButtons.forEach(button => {
    button.addEventListener("click", async () => {
      activeView = button.dataset.view;
      els.viewButtons.forEach(btn => btn.classList.toggle("active", btn === button));
      await renderCalendar();
    });
  });

  els.tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      els.tabButtons.forEach(btn => btn.classList.toggle("active", btn === button));
      els.tabSections.forEach(section => section.classList.toggle("active", section.id === button.dataset.tab));
    });
  });

  els.calendar.addEventListener("click", async (event) => {
    const day = event.target.closest(".day-cell:not(.empty)");
    if (!day) return;
    // Update selection highlight directly in the DOM without re-fetching calendar data
    document.querySelectorAll(".day-cell.selected").forEach(el => el.classList.remove("selected"));
    day.classList.add("selected");
    selectedDate = day.dataset.date;
    await Promise.all([renderSelectedDate(), renderRecipes()]);
  });

  els.recipeSelect.addEventListener("change", fillMealMacrosFromRecipe);
  els.servings.addEventListener("input", fillMealMacrosFromRecipe);

  els.nutritionForm.addEventListener("submit", handleNutritionSubmit);
  els.sleepForm.addEventListener("submit", handleSleepSubmit);
  els.exerciseForm.addEventListener("submit", handleExerciseSubmit);
  els.recipeForm.addEventListener("submit", handleRecipeSubmit);

  document.body.addEventListener("click", handleDeleteButtons);

  els.settingsBtn.addEventListener("click", () => showConfigModal());
  els.sampleDataBtn.addEventListener("click", addSampleData);
}

// ─── Render ──────────────────────────────────────────────────────────────────
async function renderAll() {
  await Promise.all([
    renderCalendar(),
    renderSelectedDate(),
    renderRecipes()
  ]);
}

// Loads all month data in 3 parallel queries, then builds the calendar synchronously.
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

  // Build lookup maps so getDayDisplayData can run synchronously per cell
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
    const key  = dateKey(year, month + 1, day);
    const data = getDayDisplayData(key, activeView, nutritionMap, sleepMap, exerciseMap);
    const classes = ["day-cell", `level-${data.level}`];
    if (key === todayKey)     classes.push("today");
    if (key === selectedDate) classes.push("selected");
    fragments.push(`
      <button class="${classes.join(" ")}" type="button" data-date="${key}" title="${escapeHtml(data.title)}">
        <span class="day-number">${day}</span>
        <span class="day-value">${escapeHtml(data.label)}</span>
      </button>
    `);
  }

  els.calendar.innerHTML = fragments.join("");
}

function renderLegend() {
  const labels = {
    nutrition: ["No meals",     "Light",    "Moderate", "High",     "Very high"],
    sleep:     ["No sleep log", "< 5h",     "5–7h",     "7–9h",     "9h+"],
    exercise:  ["No exercise",  "Small",    "Moderate", "Big",      "Very big"]
  };
  els.legend.innerHTML = labels[activeView].map((label, i) => `
    <span class="legend-swatch level-${i}"></span><span>${label}</span>
  `).join("");
}

// Uses pre-fetched maps — runs synchronously, no extra queries.
function getDayDisplayData(date, view, nutritionMap, sleepMap, exerciseMap) {
  if (view === "nutrition") {
    const row = nutritionMap[date];
    if (!row || !Number(row.meal_count)) return { level: 0, label: "-", title: "No nutrition logged" };
    const cal = Number(row.calories) || 0;
    const level = cal >= 2400 ? 4 : cal >= 1600 ? 3 : cal >= 800 ? 2 : 1;
    return { level, label: `${round(cal, 0)} kcal`, title: `${round(cal, 0)} kcal, ${round(row.protein, 1)}g protein` };
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
  const score = rows.reduce((sum, r) => sum + (Number(r.sets) || 0) + ((Number(r.duration_min) || 0) / 10), 0);
  const level = score >= 16 ? 4 : score >= 9 ? 3 : score >= 4 ? 2 : 1;
  return { level, label: `${rows.length} item${rows.length === 1 ? "" : "s"}`, title: `${rows.length} exercise log(s)` };
}

// Fetches all selected-date data in one parallel batch, then delegates to sync sub-renders.
async function renderSelectedDate() {
  const prettyDate = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
  els.selectedDateHeading.textContent = prettyDate;

  const [nutrition, sleep, exercises, mealRows] = await Promise.all([
    dbOne("SELECT * FROM daily_nutrition WHERE date = ?", [selectedDate]),
    dbOne("SELECT * FROM sleep_logs WHERE date = ?", [selectedDate]),
    dbQuery("SELECT * FROM exercise_logs WHERE date = ? ORDER BY created_at, id", [selectedDate]),
    dbQuery(`
      SELECT nutrition_logs.*, recipes.name AS recipe_name
      FROM nutrition_logs
      LEFT JOIN recipes ON recipes.id = nutrition_logs.recipe_id
      WHERE nutrition_logs.date = ?
      ORDER BY nutrition_logs.created_at, nutrition_logs.id
    `, [selectedDate])
  ]);

  const dailyNutrition = nutrition || { calories: 0, protein: 0, fat: 0, carbs: 0, meal_count: 0 };
  const totalSets    = exercises.reduce((sum, r) => sum + (Number(r.sets) || 0), 0);
  const totalMinutes = exercises.reduce((sum, r) => sum + (Number(r.duration_min) || 0), 0);

  els.summaryCards.innerHTML = `
    <div class="summary-card"><span>Nutrition</span><strong>${round(dailyNutrition.calories, 0)} kcal</strong><br><small>${round(dailyNutrition.protein, 1)}g protein</small></div>
    <div class="summary-card"><span>Sleep</span><strong>${sleep ? round(sleep.hours, 2) : "-"} h</strong><br><small>${sleep && sleep.quality ? `Quality ${sleep.quality}/5` : "No rating"}</small></div>
    <div class="summary-card"><span>Exercise</span><strong>${exercises.length}</strong><br><small>${totalSets} sets · ${round(totalMinutes, 1)} min</small></div>
  `;

  renderNutritionList(mealRows, dailyNutrition);
  renderSleepList(sleep);
  renderExerciseList(exercises);
  fillSleepForm(sleep);
}

function renderNutritionList(rows, nutrition) {
  if (!rows.length) {
    els.nutritionList.innerHTML = `<div class="empty-state">No meals logged for this day yet.</div>`;
    return;
  }

  const records = rows.map(row => {
    const name = row.recipe_name || row.custom_name || "Meal";
    return `
      <article class="record">
        <div>
          <h4>${escapeHtml(capitalize(row.meal_type))}: ${escapeHtml(name)}</h4>
          <p class="record-meta">${round(row.servings, 2)} serving(s) · ${round(row.calories, 0)} kcal · ${round(row.protein, 1)}g protein · ${round(row.fat, 1)}g fat · ${round(row.carbs, 1)}g carbs</p>
          ${row.notes ? `<p>${escapeHtml(row.notes)}</p>` : ""}
        </div>
        <button class="icon-danger" type="button" data-delete="nutrition" data-id="${row.id}">Delete</button>
      </article>
    `;
  }).join("");

  els.nutritionList.innerHTML = `
    <div class="record">
      <div>
        <h4>Daily nutrition summary</h4>
        <p class="record-meta">${round(nutrition.calories, 0)} kcal · ${round(nutrition.protein, 1)}g protein · ${round(nutrition.fat, 1)}g fat · ${round(nutrition.carbs, 1)}g carbs · ${nutrition.meal_count} meal(s)</p>
      </div>
    </div>
    ${records}
  `;
}

function renderSleepList(sleep) {
  if (!sleep) {
    els.sleepList.innerHTML = `<div class="empty-state">No sleep logged for this day yet.</div>`;
    return;
  }
  els.sleepList.innerHTML = `
    <article class="record">
      <div>
        <h4>${round(sleep.hours, 2)} hours slept</h4>
        <p class="record-meta">Quality: ${sleep.quality ? `${sleep.quality}/5` : "not rated"}</p>
        ${sleep.notes ? `<p>${escapeHtml(sleep.notes)}</p>` : ""}
      </div>
      <button class="icon-danger" type="button" data-delete="sleep" data-id="${sleep.id}">Delete</button>
    </article>
  `;
}

function renderExerciseList(rows) {
  if (!rows.length) {
    els.exerciseList.innerHTML = `<div class="empty-state">No exercises logged for this day yet.</div>`;
    return;
  }
  els.exerciseList.innerHTML = rows.map(row => {
    const strength = [
      row.sets   ? `${row.sets} sets`               : "",
      row.reps   ? `${row.reps} reps`               : "",
      row.weight ? `${round(row.weight, 1)} weight`  : ""
    ].filter(Boolean).join(" · ");
    const cardio = [
      row.duration_min ? `${round(row.duration_min, 1)} min`  : "",
      row.distance     ? `${round(row.distance, 2)} distance` : ""
    ].filter(Boolean).join(" · ");
    const details = [strength, cardio].filter(Boolean).join(" · ") || "Details not specified";
    return `
      <article class="record">
        <div>
          <h4>${escapeHtml(row.exercise_name)}</h4>
          <p class="record-meta">${row.category ? `${escapeHtml(row.category)} · ` : ""}${escapeHtml(details)}</p>
          ${row.notes ? `<p>${escapeHtml(row.notes)}</p>` : ""}
        </div>
        <button class="icon-danger" type="button" data-delete="exercise" data-id="${row.id}">Delete</button>
      </article>
    `;
  }).join("");
}

// Fetches recipes once, populates both the dropdown and the recipe list.
async function renderRecipes() {
  const recipes = await dbQuery("SELECT * FROM recipes ORDER BY name COLLATE NOCASE");
  renderRecipeOptions(recipes);
  renderRecipeList(recipes);
}

function renderRecipeOptions(recipes) {
  const currentValue = els.recipeSelect.value;
  els.recipeSelect.innerHTML = `<option value="">Custom entry</option>` +
    recipes.map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${round(r.calories, 0)} kcal / serving)</option>`).join("");
  if (recipes.some(r => String(r.id) === currentValue)) {
    els.recipeSelect.value = currentValue;
  }
}

function renderRecipeList(recipes) {
  if (!recipes.length) {
    els.recipeList.innerHTML = `<div class="empty-state">No saved recipes yet. Add common meals here so meal logging is faster.</div>`;
    return;
  }
  els.recipeList.innerHTML = recipes.map(recipe => `
    <article class="record">
      <div>
        <h4>${escapeHtml(recipe.name)}</h4>
        <p class="record-meta">${recipe.serving_size ? `${escapeHtml(recipe.serving_size)} · ` : ""}${round(recipe.calories, 0)} kcal · ${round(recipe.protein, 1)}g protein · ${round(recipe.fat, 1)}g fat · ${round(recipe.carbs, 1)}g carbs</p>
        ${recipe.notes ? `<p>${escapeHtml(recipe.notes)}</p>` : ""}
      </div>
      <button class="icon-danger" type="button" data-delete="recipe" data-id="${recipe.id}">Delete</button>
    </article>
  `).join("");
}

// ─── Form handlers ───────────────────────────────────────────────────────────
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
    await dbRun(`
      INSERT INTO nutrition_logs
        (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [selectedDate, els.mealType.value, recipeId, name || "Custom meal",
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
    await dbRun(`
      INSERT INTO sleep_logs (date, hours, quality, notes, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(date) DO UPDATE SET
        hours      = excluded.hours,
        quality    = excluded.quality,
        notes      = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `, [selectedDate, numberOrDefault(els.sleepHours.value, 0),
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
  try {
    await dbRun(`
      INSERT INTO exercise_logs
        (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      selectedDate,
      els.exerciseName.value.trim(),
      els.exerciseCategory.value.trim(),
      nullableInt(els.exerciseSets.value),
      nullableInt(els.exerciseReps.value),
      nullableNumber(els.exerciseWeight.value),
      nullableNumber(els.exerciseDuration.value),
      nullableNumber(els.exerciseDistance.value),
      els.exerciseNotes.value.trim()
    ]);
    els.exerciseForm.reset();
    setStatus("Saved");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Save failed", true);
  }
}

async function handleRecipeSubmit(event) {
  event.preventDefault();
  try {
    await dbRun(`
      INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        serving_size = excluded.serving_size,
        calories     = excluded.calories,
        protein      = excluded.protein,
        fat          = excluded.fat,
        carbs        = excluded.carbs,
        notes        = excluded.notes,
        updated_at   = CURRENT_TIMESTAMP
    `, [
      els.recipeName.value.trim(),
      els.recipeServingSize.value.trim(),
      numberOrDefault(els.recipeCalories.value, 0),
      numberOrDefault(els.recipeProtein.value, 0),
      numberOrDefault(els.recipeFat.value, 0),
      numberOrDefault(els.recipeCarbs.value, 0),
      els.recipeNotes.value.trim()
    ]);
    els.recipeForm.reset();
    [els.recipeCalories, els.recipeProtein, els.recipeFat, els.recipeCarbs].forEach(inp => { inp.value = "0"; });
    setStatus("Saved");
    await renderRecipes();
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
    } else if (type === "recipe") {
      await dbRun("DELETE FROM recipes WHERE id = ?", [id]);
    }
    setStatus("Deleted");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Delete failed", true);
  }
}

// ─── Form helpers ────────────────────────────────────────────────────────────
function fillSleepForm(sleep) {
  els.sleepHours.value   = sleep ? sleep.hours : "";
  els.sleepQuality.value = sleep && sleep.quality ? String(sleep.quality) : "";
  els.sleepNotes.value   = sleep ? (sleep.notes || "") : "";
}

async function fillMealMacrosFromRecipe() {
  const recipeId = nullableInt(els.recipeSelect.value);
  if (!recipeId) return;
  try {
    const recipe = await dbOne("SELECT * FROM recipes WHERE id = ?", [recipeId]);
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

// ─── Data mutations ──────────────────────────────────────────────────────────
async function recalculateDailyNutrition(date) {
  const totals = await dbOne(`
    SELECT
      COUNT(*)                  AS meal_count,
      COALESCE(SUM(calories), 0) AS calories,
      COALESCE(SUM(protein),  0) AS protein,
      COALESCE(SUM(fat),      0) AS fat,
      COALESCE(SUM(carbs),    0) AS carbs
    FROM nutrition_logs WHERE date = ?
  `, [date]);

  if (!totals || Number(totals.meal_count) === 0) {
    await dbRun("DELETE FROM daily_nutrition WHERE date = ?", [date]);
    return;
  }

  await dbRun(`
    INSERT INTO daily_nutrition (date, calories, protein, fat, carbs, meal_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      calories   = excluded.calories,
      protein    = excluded.protein,
      fat        = excluded.fat,
      carbs      = excluded.carbs,
      meal_count = excluded.meal_count,
      updated_at = CURRENT_TIMESTAMP
  `, [date, totals.calories, totals.protein, totals.fat, totals.carbs, totals.meal_count]);
}

async function addSampleData() {
  setStatus("Adding sample data…", true);
  try {
    const today = selectedDate;

    // Insert recipes; ignore if they already exist
    await dbBatch([
      { sql: `INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`,
        params: ["Greek yogurt bowl", "1 bowl", 420, 38, 8, 48, "Yogurt, berries, oats, honey"] },
      { sql: `INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`,
        params: ["Chicken rice bowl", "1 bowl", 690, 55, 18, 76, "Chicken breast, rice, vegetables, sauce"] },
      { sql: `INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING`,
        params: ["Turkey wrap", "1 wrap", 520, 42, 16, 48, "Turkey, tortilla, cheese, vegetables"] }
    ]);

    // Fetch IDs (recipes may have pre-existed, so we can't rely on lastRowId)
    const [yogurt, wrap] = await Promise.all([
      dbOne("SELECT * FROM recipes WHERE name = ?", ["Greek yogurt bowl"]),
      dbOne("SELECT * FROM recipes WHERE name = ?", ["Turkey wrap"])
    ]);

    await Promise.all([
      yogurt
        ? dbRun(`INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [today, "breakfast", yogurt.id, yogurt.name, 1, yogurt.calories, yogurt.protein, yogurt.fat, yogurt.carbs, "Sample breakfast"])
        : Promise.resolve(),
      wrap
        ? dbRun(`INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [today, "lunch", wrap.id, wrap.name, 1, wrap.calories, wrap.protein, wrap.fat, wrap.carbs, "Sample lunch"])
        : Promise.resolve(),
      dbRun(`INSERT INTO sleep_logs (date, hours, quality, notes, updated_at)
              VALUES (?, 7.5, 4, 'Sample sleep log', CURRENT_TIMESTAMP)
              ON CONFLICT(date) DO UPDATE SET
                hours = excluded.hours, quality = excluded.quality,
                notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`, [today]),
      dbRun(`INSERT INTO exercise_logs (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes)
              VALUES (?, 'Goblet squat', 'Legs', 3, 10, 40, NULL, NULL, 'Sample strength entry')`, [today]),
      dbRun(`INSERT INTO exercise_logs (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes)
              VALUES (?, 'Incline walk', 'Cardio', NULL, NULL, NULL, 20, 1.2, 'Sample cardio entry')`, [today])
    ]);

    await recalculateDailyNutrition(today);
    setStatus("Sample data added");
    await renderAll();
  } catch (err) {
    console.error(err);
    setStatus("Failed to add sample data", true);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────
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
  const n = Number(value) || 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return decimals === 0 ? String(Math.round(rounded)) : String(rounded);
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
