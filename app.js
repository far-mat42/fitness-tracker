/* global initSqlJs */

const SQL_JS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/";
const IDB_NAME = "all_in_one_fitness_tracker";
const IDB_STORE = "sqlite";
const IDB_KEY = "main-db";

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sleep_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  hours REAL NOT NULL CHECK (hours >= 0 AND hours <= 24),
  quality INTEGER CHECK (quality IS NULL OR (quality >= 1 AND quality <= 5)),
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exercise_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  category TEXT,
  sets INTEGER CHECK (sets IS NULL OR sets >= 0),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  weight REAL CHECK (weight IS NULL OR weight >= 0),
  duration_min REAL CHECK (duration_min IS NULL OR duration_min >= 0),
  distance REAL CHECK (distance IS NULL OR distance >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  serving_size TEXT,
  calories REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL DEFAULT 'meal',
  recipe_id INTEGER,
  custom_name TEXT,
  servings REAL NOT NULL DEFAULT 1 CHECK (servings > 0),
  calories REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS daily_nutrition (
  date TEXT PRIMARY KEY,
  calories REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  meal_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sleep_logs_date ON sleep_logs(date);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_date ON exercise_logs(date);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_date ON nutrition_logs(date);
CREATE INDEX IF NOT EXISTS idx_recipes_name ON recipes(name);
`;

let SQL;
let db;
let currentMonth;
let selectedDate;
let activeView = "nutrition";
let saveTimer;

const els = {};

window.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  setInitialDates();
  bindEvents();
  setStatus("Loading SQLite...", true);

  try {
    SQL = await initSqlJs({ locateFile: file => `${SQL_JS_CDN}${file}` });
    const stored = await loadDbFromIndexedDb();
    db = stored ? new SQL.Database(new Uint8Array(stored)) : new SQL.Database();
    db.run(SCHEMA_SQL);
    setStatus(stored ? "Loaded saved DB" : "New DB ready");
    renderAll();
    queuePersist();
  } catch (error) {
    console.error(error);
    setStatus("SQLite failed to load", true);
    alert("SQLite failed to load. Check your network connection because sql.js is loaded from a CDN.");
  }
});

function cacheElements() {
  const ids = [
    "downloadDbBtn", "uploadDbInput", "sampleDataBtn", "newDbBtn", "prevMonthBtn", "nextMonthBtn", "todayBtn",
    "monthLabel", "calendar", "legend", "selectedDateHeading", "dbStatus", "summaryCards",
    "nutritionForm", "mealType", "recipeSelect", "nutritionName", "servings", "mealCalories", "mealProtein", "mealFat", "mealCarbs", "nutritionNotes", "nutritionList",
    "sleepForm", "sleepHours", "sleepQuality", "sleepNotes", "sleepList",
    "exerciseForm", "exerciseName", "exerciseCategory", "exerciseSets", "exerciseReps", "exerciseWeight", "exerciseDuration", "exerciseDistance", "exerciseNotes", "exerciseList",
    "recipeForm", "recipeName", "recipeServingSize", "recipeCalories", "recipeProtein", "recipeFat", "recipeCarbs", "recipeNotes", "recipeList"
  ];
  ids.forEach(id => { els[id] = document.getElementById(id); });
  els.viewButtons = Array.from(document.querySelectorAll(".view-btn"));
  els.tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  els.tabSections = Array.from(document.querySelectorAll(".tab-section"));
}

function setInitialDates() {
  const today = new Date();
  currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedDate = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function bindEvents() {
  els.prevMonthBtn.addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    renderCalendar();
  });

  els.nextMonthBtn.addEventListener("click", () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  els.todayBtn.addEventListener("click", () => {
    const today = new Date();
    currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDate = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
    renderAll();
  });

  els.viewButtons.forEach(button => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      els.viewButtons.forEach(btn => btn.classList.toggle("active", btn === button));
      renderCalendar();
    });
  });

  els.tabButtons.forEach(button => {
    button.addEventListener("click", () => {
      els.tabButtons.forEach(btn => btn.classList.toggle("active", btn === button));
      els.tabSections.forEach(section => section.classList.toggle("active", section.id === button.dataset.tab));
    });
  });

  els.calendar.addEventListener("click", event => {
    const day = event.target.closest(".day-cell:not(.empty)");
    if (!day) return;
    selectedDate = day.dataset.date;
    renderAll();
  });

  els.recipeSelect.addEventListener("change", fillMealMacrosFromRecipe);
  els.servings.addEventListener("input", fillMealMacrosFromRecipe);

  els.nutritionForm.addEventListener("submit", handleNutritionSubmit);
  els.sleepForm.addEventListener("submit", handleSleepSubmit);
  els.exerciseForm.addEventListener("submit", handleExerciseSubmit);
  els.recipeForm.addEventListener("submit", handleRecipeSubmit);

  document.body.addEventListener("click", handleDeleteButtons);

  els.downloadDbBtn.addEventListener("click", downloadDb);
  els.uploadDbInput.addEventListener("change", handleUploadDb);
  els.sampleDataBtn.addEventListener("click", addSampleData);
  els.newDbBtn.addEventListener("click", createBlankDb);
}

function renderAll() {
  if (!db) return;
  renderCalendar();
  renderSelectedDate();
  renderRecipeOptions();
  renderRecipeList();
}

function renderCalendar() {
  if (!db) return;
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthName = currentMonth.toLocaleString(undefined, { month: "long", year: "numeric" });
  els.monthLabel.textContent = monthName;
  renderLegend();

  const todayKey = formatDateKey(new Date());
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fragments = [];

  weekdays.forEach(day => {
    fragments.push(`<div class="weekday">${day}</div>`);
  });

  for (let i = 0; i < firstWeekday; i += 1) {
    fragments.push(`<button class="day-cell empty" type="button" tabindex="-1"></button>`);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(year, month + 1, day);
    const data = getDayDisplayData(key, activeView);
    const classes = ["day-cell", `level-${data.level}`];
    if (key === todayKey) classes.push("today");
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
    nutrition: ["No meals", "Light", "Moderate", "High", "Very high"],
    sleep: ["No sleep log", "< 5h", "5-7h", "7-9h", "9h+"],
    exercise: ["No exercise", "Small", "Moderate", "Big", "Very big"]
  };
  els.legend.innerHTML = labels[activeView].map((label, index) => `
    <span class="legend-swatch level-${index}"></span><span>${label}</span>
  `).join("");
}

function renderSelectedDate() {
  const prettyDate = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
  els.selectedDateHeading.textContent = prettyDate;

  const nutrition = getDailyNutrition(selectedDate);
  const sleep = getSleep(selectedDate);
  const exercises = getExercises(selectedDate);

  const totalSets = exercises.reduce((sum, item) => sum + (Number(item.sets) || 0), 0);
  const totalMinutes = exercises.reduce((sum, item) => sum + (Number(item.duration_min) || 0), 0);

  els.summaryCards.innerHTML = `
    <div class="summary-card"><span>Nutrition</span><strong>${round(nutrition.calories, 0)} kcal</strong><br><small>${round(nutrition.protein, 1)}g protein</small></div>
    <div class="summary-card"><span>Sleep</span><strong>${sleep ? round(sleep.hours, 2) : "-"} h</strong><br><small>${sleep && sleep.quality ? `Quality ${sleep.quality}/5` : "No rating"}</small></div>
    <div class="summary-card"><span>Exercise</span><strong>${exercises.length}</strong><br><small>${totalSets} sets · ${round(totalMinutes, 1)} min</small></div>
  `;

  renderNutritionList();
  renderSleepList();
  renderExerciseList();
  fillSleepForm();
}

function renderNutritionList() {
  const rows = selectRows(`
    SELECT nutrition_logs.*, recipes.name AS recipe_name
    FROM nutrition_logs
    LEFT JOIN recipes ON recipes.id = nutrition_logs.recipe_id
    WHERE nutrition_logs.date = ?
    ORDER BY nutrition_logs.created_at, nutrition_logs.id
  `, [selectedDate]);

  if (!rows.length) {
    els.nutritionList.innerHTML = `<div class="empty-state">No meals logged for this day yet.</div>`;
    return;
  }

  const nutrition = getDailyNutrition(selectedDate);
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

function renderSleepList() {
  const sleep = getSleep(selectedDate);
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

function renderExerciseList() {
  const rows = getExercises(selectedDate);
  if (!rows.length) {
    els.exerciseList.innerHTML = `<div class="empty-state">No exercises logged for this day yet.</div>`;
    return;
  }

  els.exerciseList.innerHTML = rows.map(row => {
    const strength = [
      row.sets ? `${row.sets} sets` : "",
      row.reps ? `${row.reps} reps` : "",
      row.weight ? `${round(row.weight, 1)} weight` : ""
    ].filter(Boolean).join(" · ");
    const cardio = [
      row.duration_min ? `${round(row.duration_min, 1)} min` : "",
      row.distance ? `${round(row.distance, 2)} distance` : ""
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

function renderRecipeOptions() {
  const recipes = getRecipes();
  const currentValue = els.recipeSelect.value;
  els.recipeSelect.innerHTML = `<option value="">Custom entry</option>` + recipes.map(recipe => `
    <option value="${recipe.id}">${escapeHtml(recipe.name)} (${round(recipe.calories, 0)} kcal / serving)</option>
  `).join("");
  if (recipes.some(recipe => String(recipe.id) === currentValue)) {
    els.recipeSelect.value = currentValue;
  }
}

function renderRecipeList() {
  const recipes = getRecipes();
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

function handleNutritionSubmit(event) {
  event.preventDefault();
  const recipeId = nullableInt(els.recipeSelect.value);
  const servings = numberOrDefault(els.servings.value, 1);
  const selectedRecipe = recipeId ? getRecipe(recipeId) : null;

  let calories = numberOrDefault(els.mealCalories.value, 0);
  let protein = numberOrDefault(els.mealProtein.value, 0);
  let fat = numberOrDefault(els.mealFat.value, 0);
  let carbs = numberOrDefault(els.mealCarbs.value, 0);
  let name = els.nutritionName.value.trim();

  if (selectedRecipe) {
    calories = selectedRecipe.calories * servings;
    protein = selectedRecipe.protein * servings;
    fat = selectedRecipe.fat * servings;
    carbs = selectedRecipe.carbs * servings;
    name = name || selectedRecipe.name;
  }

  db.run(`
    INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    selectedDate,
    els.mealType.value,
    recipeId,
    name || "Custom meal",
    servings,
    calories,
    protein,
    fat,
    carbs,
    els.nutritionNotes.value.trim()
  ]);

  recalculateDailyNutrition(selectedDate);
  els.nutritionForm.reset();
  els.servings.value = "1";
  [els.mealCalories, els.mealProtein, els.mealFat, els.mealCarbs].forEach(input => { input.value = "0"; });
  queuePersistAndRender();
}

function handleSleepSubmit(event) {
  event.preventDefault();
  db.run(`
    INSERT INTO sleep_logs (date, hours, quality, notes, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      hours = excluded.hours,
      quality = excluded.quality,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `, [
    selectedDate,
    numberOrDefault(els.sleepHours.value, 0),
    nullableInt(els.sleepQuality.value),
    els.sleepNotes.value.trim()
  ]);
  queuePersistAndRender();
}

function handleExerciseSubmit(event) {
  event.preventDefault();
  db.run(`
    INSERT INTO exercise_logs (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes)
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
  queuePersistAndRender();
}

function handleRecipeSubmit(event) {
  event.preventDefault();
  db.run(`
    INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      serving_size = excluded.serving_size,
      calories = excluded.calories,
      protein = excluded.protein,
      fat = excluded.fat,
      carbs = excluded.carbs,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
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
  [els.recipeCalories, els.recipeProtein, els.recipeFat, els.recipeCarbs].forEach(input => { input.value = "0"; });
  queuePersistAndRender();
}

function handleDeleteButtons(event) {
  const button = event.target.closest("button[data-delete]");
  if (!button || !db) return;
  const type = button.dataset.delete;
  const id = Number(button.dataset.id);

  if (type === "nutrition") {
    db.run("DELETE FROM nutrition_logs WHERE id = ?", [id]);
    recalculateDailyNutrition(selectedDate);
  } else if (type === "sleep") {
    db.run("DELETE FROM sleep_logs WHERE id = ?", [id]);
  } else if (type === "exercise") {
    db.run("DELETE FROM exercise_logs WHERE id = ?", [id]);
  } else if (type === "recipe") {
    db.run("DELETE FROM recipes WHERE id = ?", [id]);
  }

  queuePersistAndRender();
}

function fillSleepForm() {
  const sleep = getSleep(selectedDate);
  els.sleepHours.value = sleep ? sleep.hours : "";
  els.sleepQuality.value = sleep && sleep.quality ? String(sleep.quality) : "";
  els.sleepNotes.value = sleep ? (sleep.notes || "") : "";
}

function fillMealMacrosFromRecipe() {
  const recipeId = nullableInt(els.recipeSelect.value);
  const recipe = recipeId ? getRecipe(recipeId) : null;
  if (!recipe) return;

  const servings = numberOrDefault(els.servings.value, 1);
  els.nutritionName.value = recipe.name;
  els.mealCalories.value = round(recipe.calories * servings, 0);
  els.mealProtein.value = round(recipe.protein * servings, 1);
  els.mealFat.value = round(recipe.fat * servings, 1);
  els.mealCarbs.value = round(recipe.carbs * servings, 1);
}

function getDayDisplayData(date, view) {
  if (view === "nutrition") {
    const row = getDailyNutrition(date);
    if (!row.meal_count) return { level: 0, label: "-", title: "No nutrition logged" };
    const calories = Number(row.calories) || 0;
    const level = calories >= 2400 ? 4 : calories >= 1600 ? 3 : calories >= 800 ? 2 : 1;
    return { level, label: `${round(calories, 0)} kcal`, title: `${round(calories, 0)} kcal, ${round(row.protein, 1)}g protein` };
  }

  if (view === "sleep") {
    const row = getSleep(date);
    if (!row) return { level: 0, label: "-", title: "No sleep logged" };
    const hours = Number(row.hours) || 0;
    const level = hours >= 9 ? 4 : hours >= 7 ? 3 : hours >= 5 ? 2 : 1;
    return { level, label: `${round(hours, 1)} h`, title: `${round(hours, 2)} hours slept` };
  }

  const rows = getExercises(date);
  if (!rows.length) return { level: 0, label: "-", title: "No exercise logged" };
  const score = rows.reduce((sum, row) => {
    return sum + (Number(row.sets) || 0) + ((Number(row.duration_min) || 0) / 10);
  }, 0);
  const level = score >= 16 ? 4 : score >= 9 ? 3 : score >= 4 ? 2 : 1;
  return { level, label: `${rows.length} item${rows.length === 1 ? "" : "s"}`, title: `${rows.length} exercise log(s)` };
}

function getSleep(date) {
  return selectOne("SELECT * FROM sleep_logs WHERE date = ?", [date]);
}

function getExercises(date) {
  return selectRows("SELECT * FROM exercise_logs WHERE date = ? ORDER BY created_at, id", [date]);
}

function getDailyNutrition(date) {
  return selectOne("SELECT * FROM daily_nutrition WHERE date = ?", [date]) || {
    date, calories: 0, protein: 0, fat: 0, carbs: 0, meal_count: 0
  };
}

function getRecipes() {
  return selectRows("SELECT * FROM recipes ORDER BY name COLLATE NOCASE", []);
}

function getRecipe(id) {
  return selectOne("SELECT * FROM recipes WHERE id = ?", [id]);
}

function recalculateDailyNutrition(date) {
  const totals = selectOne(`
    SELECT
      COUNT(*) AS meal_count,
      COALESCE(SUM(calories), 0) AS calories,
      COALESCE(SUM(protein), 0) AS protein,
      COALESCE(SUM(fat), 0) AS fat,
      COALESCE(SUM(carbs), 0) AS carbs
    FROM nutrition_logs
    WHERE date = ?
  `, [date]);

  if (!totals || Number(totals.meal_count) === 0) {
    db.run("DELETE FROM daily_nutrition WHERE date = ?", [date]);
    return;
  }

  db.run(`
    INSERT INTO daily_nutrition (date, calories, protein, fat, carbs, meal_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      calories = excluded.calories,
      protein = excluded.protein,
      fat = excluded.fat,
      carbs = excluded.carbs,
      meal_count = excluded.meal_count,
      updated_at = CURRENT_TIMESTAMP
  `, [date, totals.calories, totals.protein, totals.fat, totals.carbs, totals.meal_count]);
}

function selectRows(sql, params = []) {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];
  while (statement.step()) {
    rows.push(statement.getAsObject());
  }
  statement.free();
  return rows;
}

function selectOne(sql, params = []) {
  return selectRows(sql, params)[0] || null;
}

async function queuePersistAndRender() {
  renderAll();
  queuePersist();
}

function queuePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveDbToIndexedDb(db.export());
      setStatus("Saved locally");
    } catch (error) {
      console.error(error);
      setStatus("Local save failed", true);
    }
  }, 250);
}

async function loadDbFromIndexedDb() {
  const database = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveDbToIndexedDb(uint8Array) {
  const database = await openIndexedDb();
  const buffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(buffer, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function openIndexedDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function downloadDb() {
  if (!db) return;
  const bytes = db.export();
  const blob = new Blob([bytes], { type: "application/vnd.sqlite3" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `fitness-tracker-${selectedDate}.sqlite`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function handleUploadDb(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = new SQL.Database(new Uint8Array(reader.result));
      imported.run(SCHEMA_SQL);
      db = imported;
      await saveDbToIndexedDb(db.export());
      setStatus(`Loaded ${file.name}`);
      renderAll();
    } catch (error) {
      console.error(error);
      alert("That file could not be opened as a SQLite database.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}

function addSampleData() {
  const today = selectedDate;
  const recipes = [
    ["Greek yogurt bowl", "1 bowl", 420, 38, 8, 48, "Yogurt, berries, oats, honey"],
    ["Chicken rice bowl", "1 bowl", 690, 55, 18, 76, "Chicken breast, rice, vegetables, sauce"],
    ["Turkey wrap", "1 wrap", 520, 42, 16, 48, "Turkey, tortilla, cheese, vegetables"]
  ];

  recipes.forEach(recipe => {
    db.run(`
      INSERT INTO recipes (name, serving_size, calories, protein, fat, carbs, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO NOTHING
    `, recipe);
  });

  const yogurt = selectOne("SELECT * FROM recipes WHERE name = ?", ["Greek yogurt bowl"]);
  const wrap = selectOne("SELECT * FROM recipes WHERE name = ?", ["Turkey wrap"]);
  if (yogurt) {
    db.run(`
      INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [today, "breakfast", yogurt.id, yogurt.name, 1, yogurt.calories, yogurt.protein, yogurt.fat, yogurt.carbs, "Sample breakfast"]);
  }
  if (wrap) {
    db.run(`
      INSERT INTO nutrition_logs (date, meal_type, recipe_id, custom_name, servings, calories, protein, fat, carbs, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [today, "lunch", wrap.id, wrap.name, 1, wrap.calories, wrap.protein, wrap.fat, wrap.carbs, "Sample lunch"]);
  }

  db.run(`
    INSERT INTO sleep_logs (date, hours, quality, notes, updated_at)
    VALUES (?, 7.5, 4, 'Sample sleep log', CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET hours = excluded.hours, quality = excluded.quality, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
  `, [today]);

  db.run(`
    INSERT INTO exercise_logs (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes)
    VALUES (?, 'Goblet squat', 'Legs', 3, 10, 40, NULL, NULL, 'Sample strength entry')
  `, [today]);
  db.run(`
    INSERT INTO exercise_logs (date, exercise_name, category, sets, reps, weight, duration_min, distance, notes)
    VALUES (?, 'Incline walk', 'Cardio', NULL, NULL, NULL, 20, 1.2, 'Sample cardio entry')
  `, [today]);

  recalculateDailyNutrition(today);
  queuePersistAndRender();
}

async function createBlankDb() {
  const confirmed = window.confirm("Create a new blank database? Download your current DB first if you want to keep it.");
  if (!confirmed) return;
  db = new SQL.Database();
  db.run(SCHEMA_SQL);
  await saveDbToIndexedDb(db.export());
  setStatus("New blank DB ready");
  renderAll();
}

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
