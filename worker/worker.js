export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return respond(null, 204);
    }

    const url = new URL(request.url);

    // Public read-only endpoint — no auth required
    if (request.method === "GET" && url.pathname === "/list") {
      const [recipes, exercises] = await Promise.all([
        env.DB.prepare(
          "SELECT id, name, calories, protein, fat, carbs, allow_weight_logging, grams_per_serving, weight_unit FROM recipes ORDER BY name COLLATE NOCASE"
        ).all(),
        env.DB.prepare(
          "SELECT id, name, tracking_type, allow_sets_reps, allow_distance FROM exercises ORDER BY name COLLATE NOCASE"
        ).all(),
      ]);
      return respond({ recipes: recipes.results, exercises: exercises.results });
    }

    const auth = request.headers.get("Authorization");
    if (!auth || auth !== `Bearer ${env.AUTH_SECRET}`) {
      return respond({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return respond({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return respond({ error: "Invalid JSON" }, 400);
    }

    try {
      if (url.pathname === "/query") {
        // SELECT — returns array of row objects
        const { sql, params = [] } = body;
        const result = await env.DB.prepare(sql).bind(...params).all();
        return respond({ rows: result.results });

      } else if (url.pathname === "/run") {
        // INSERT / UPDATE / DELETE — returns change metadata
        const { sql, params = [] } = body;
        const result = await env.DB.prepare(sql).bind(...params).run();
        return respond({
          success: result.success,
          changes: result.meta.changes,
          lastRowId: result.meta.last_row_id,
        });

      } else if (url.pathname === "/batch") {
        // Multiple statements executed atomically in a transaction.
        // Body: { statements: [{ sql, params? }, ...] }
        // Returns: { results: [{ rows?, changes?, lastRowId? }, ...] }
        const { statements } = body;
        const stmts = statements.map(({ sql, params = [] }) =>
          env.DB.prepare(sql).bind(...params)
        );
        const results = await env.DB.batch(stmts);
        return respond({
          results: results.map((r) => ({
            rows: r.results ?? [],
            changes: r.meta?.changes,
            lastRowId: r.meta?.last_row_id,
          })),
        });

      } else {
        return respond({ error: "Not found" }, 404);
      }
    } catch (err) {
      console.error(err);
      return respond({ error: err.message }, 500);
    }
  },
};

function respond(body, status = 200) {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
