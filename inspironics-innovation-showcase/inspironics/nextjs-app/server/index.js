/* Optional Express API backed by PostgreSQL.
   Run with: npm run api   (after db:schema + db:seed)
   The front end works without this using the bundled JSON; point
   NEXT_PUBLIC_DATA_SOURCE at http://localhost:4000/api/items to use it. */
const express = require("express");
const cors = require("cors");
const { pool } = require("./db");
require("dotenv").config({ path: ".env.local" });

const app = express();
app.use(cors());
app.use(express.json());

const rowToItem = (r) => ({
  f: r.file, t: r.thumb, full: r.full, cat: r.category, tag: r.tag,
  title: r.title, w: r.w, h: r.h, tech: r.tech, esg: r.esg, ai: r.ai, iot: r.iot,
  objective: r.objective, flow: r.flow, components: r.components,
  architecture: r.architecture, bizben: r.bizben, techben: r.techben,
  takeaway: r.takeaway, flagship: r.flagship,
});

// List with optional filters: ?cat=&q=&tech=&esg=1&ai=1&iot=1
app.get("/api/items", async (req, res) => {
  try {
    const { cat, q, tech, esg, ai, iot } = req.query;
    const where = [];
    const args = [];
    if (cat && cat !== "All") { args.push(cat); where.push(`category = $${args.length}`); }
    if (tech) { args.push(tech); where.push(`$${args.length} = ANY(tech)`); }
    if (esg === "1") where.push("esg = true");
    if (ai === "1") where.push("ai = true");
    if (iot === "1") where.push("iot = true");
    if (q) { args.push(`%${q}%`); where.push(`(title ILIKE $${args.length} OR objective ILIKE $${args.length})`); }
    const sql = `SELECT * FROM infographics ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY flagship DESC, category, file`;
    const { rows } = await pool.query(sql, args);
    res.json({ total: rows.length, items: rows.map(rowToItem) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/items/:file", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM infographics WHERE file = $1", [req.params.file]);
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rowToItem(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/meta", async (_req, res) => {
  try {
    const cats = await pool.query("SELECT category AS name, COUNT(*)::int AS count FROM infographics GROUP BY category ORDER BY count DESC");
    const techs = await pool.query("SELECT DISTINCT unnest(tech) AS t FROM infographics ORDER BY t");
    res.json({ cats: cats.rows, techs: techs.rows.map((r) => r.t) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const port = process.env.API_PORT || 4000;
app.listen(port, () => console.log(`Inspironics API on http://localhost:${port}`));
