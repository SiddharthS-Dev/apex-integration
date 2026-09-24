/* Seeds PostgreSQL from data/showcase.json.
   Usage: npm run db:schema && npm run db:seed */
const fs = require("fs");
const path = require("path");
const { pool } = require("../server/db");

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/showcase.json"), "utf8"));
  const flagship = new Set(data.flagship || []);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE infographics RESTART IDENTITY");
    for (const it of data.items) {
      await client.query(
        `INSERT INTO infographics
         (file,thumb,full,category,tag,title,w,h,tech,esg,ai,iot,objective,flow,components,architecture,bizben,techben,takeaway,flagship)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          it.f, it.t, it.full || `full/${it.f.replace(/\.jpg$/i, ".webp")}`, it.cat, it.tag, it.title,
          it.w, it.h, it.tech, it.esg, it.ai, it.iot, it.objective, it.flow, it.components,
          it.architecture, it.bizben, it.techben, it.takeaway, flagship.has(it.f),
        ]
      );
    }
    await client.query("COMMIT");
    console.log(`Seeded ${data.items.length} infographics.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
