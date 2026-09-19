/*
 * AI auto-description pipeline — OpenAI Vision.
 *
 * Reads every image under ../public/images (or the IMAGES_DIR env), asks an
 * OpenAI vision model to read the diagram + arrows and return the structured
 * 8-field breakdown, and writes the merged result to ../data/showcase.json.
 *
 * Requires OPENAI_API_KEY in .env.local. Run:  npm run ai:describe
 *
 * This is the "real AI" path described in the spec. The bundled showcase.json
 * already contains OCR-derived content, so this script is optional — run it to
 * upgrade every card to true vision-generated copy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(ROOT, "public", "images");
const OUT = path.join(ROOT, "data", "showcase.json");
const MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";

if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY in .env.local first.");
  process.exit(1);
}
const openai = new OpenAI();

const SCHEMA_PROMPT = `You are analysing a single technical infographic from the Inspironics platform
(agentic AI for sustainable infrastructure). Read all visible text (OCR), follow the
arrows and flow, and identify the architecture layers. Return STRICT JSON with keys:
{
 "title": string,                     // the infographic's real title
 "category": one of ["Command Decks","Value Frameworks","Data & Analytics","Systems & Architecture","Intelligence Stack","Blueprints & Schematics"],
 "objective": string,                 // 1-2 sentence business objective
 "flow": string[],                    // ordered process-flow steps
 "components": string[],              // key components / building blocks
 "architecture": string,             // 2-3 sentence architecture explanation
 "bizben": string[],                  // business benefits
 "techben": string[],                 // technical benefits
 "takeaway": string,                  // single key takeaway sentence
 "tech": string[],                    // technologies present, e.g. "IoT Sensors","Agentic AI","Digital Twin","Carbon / ESG"
 "esg": boolean, "ai": boolean, "iot": boolean
}
Only output JSON, no prose.`;

function imgToDataURL(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function describe(file) {
  const resp = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SCHEMA_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyse this infographic and return the JSON." },
          { type: "image_url", image_url: { url: imgToDataURL(file), detail: "high" } },
        ],
      },
    ],
  });
  return JSON.parse(resp.choices[0].message.content);
}

async function main() {
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { items: [] };
  const byFile = new Map(existing.items.map((i) => [i.f, i]));
  const files = fs.readdirSync(IMAGES_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();

  let done = 0;
  for (const f of files) {
    try {
      const ai = await describe(path.join(IMAGES_DIR, f));
      const base = byFile.get(f) || { f, t: `thumbs/${f.replace(/\.[^.]+$/, ".webp")}`, full: `full/${f.replace(/\.[^.]+$/, ".webp")}` };
      byFile.set(f, {
        ...base,
        cat: ai.category || base.cat,
        title: ai.title || base.title,
        objective: ai.objective, flow: ai.flow, components: ai.components,
        architecture: ai.architecture, bizben: ai.bizben, techben: ai.techben,
        takeaway: ai.takeaway, tech: ai.tech || [], esg: !!ai.esg, ai: !!ai.ai, iot: !!ai.iot,
      });
      done++;
      if (done % 10 === 0) console.log(`...${done}/${files.length}`);
    } catch (e) {
      console.warn("skip", f, e.message);
    }
  }

  const items = [...byFile.values()];
  const cats = {};
  items.forEach((i) => (cats[i.cat] = (cats[i.cat] || 0) + 1));
  const out = {
    items, total: items.length,
    cats: Object.entries(cats).map(([name, count]) => ({ name, count })),
    techs: [...new Set(items.flatMap((i) => i.tech || []))],
    esgN: items.filter((i) => i.esg).length,
    aiN: items.filter((i) => i.ai).length,
    iotN: items.filter((i) => i.iot).length,
    flagship: existing.flagship || [],
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Done. Wrote ${items.length} items to ${OUT}`);
}
main();
