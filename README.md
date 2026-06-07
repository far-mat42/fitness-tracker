# All-in-One Diet, Health & Fitness Tracker

A static, GitHub Pages-friendly starter app for tracking:

- Daily nutrition: calories, protein, fat, carbohydrates
- Saved recipes/meals and their per-serving nutrition
- Sleep hours, sleep quality, and notes
- Exercise logs with sets/reps/weight and/or duration/distance
- Calendar heatmap views for nutrition, sleep, and exercise

## Why this uses sql.js

GitHub Pages can only host static files, so it cannot run a traditional server-side SQLite database. This prototype uses [sql.js](https://sql.js.org/) to run SQLite inside the browser. Your data is still stored as a real SQLite database and can be exported/imported as a `.sqlite` file.

Current behavior:

1. The app loads SQLite in the browser from a CDN.
2. Data is auto-saved to browser IndexedDB after edits.
3. You can click **Download SQLite DB** to save a real `.sqlite` file.
4. You can click **Load SQLite DB** to restore/import an existing database file.

For a future multi-device/server-backed version, move the same schema into a small backend API, for example Node.js + Express + better-sqlite3.

## Files

- `index.html` - main page and app layout
- `styles.css` - responsive styling and calendar heatmap colors
- `app.js` - browser-side SQLite logic, forms, calendar rendering, IndexedDB persistence
- `schema.sql` - standalone SQLite schema for reference or future backend use
- `index.single-file.html` - optional all-in-one HTML file with CSS and app JS embedded

## Run locally

Open `index.html` in a browser, or open `index.single-file.html` if you want the prototype packed into one HTML file. Because sql.js is loaded from a CDN, you need an internet connection the first time the app loads.

A local static server is recommended:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Host on GitHub Pages

1. Create a new GitHub repository.
2. Commit `index.html`, `styles.css`, `app.js`, and `schema.sql` to the repository root.
3. In GitHub, go to **Settings -> Pages**.
4. Set the source to your main branch and root folder.
5. Open the GitHub Pages URL once it is published.

## Database tables

The schema includes:

- `sleep_logs`
- `exercise_logs`
- `recipes`
- `nutrition_logs`
- `daily_nutrition`

`daily_nutrition` is a summary table recalculated from `nutrition_logs` each time meals are added or removed.

## Next features to add

Good next steps:

- Add bodyweight and measurements tables
- Add macro/calorie targets per day
- Add weekly/monthly charts
- Add editing for existing entries, not just delete/re-add
- Add recipe ingredients and automatic recipe totals
- Add exercise templates and workout routines
- Add import from CSV or wearable exports
- Add a real backend for syncing across devices
