/* Copies the image assets from the parent folder into public/ so Next.js serves them.
   Run once before `npm run dev`:  node scripts/copy-images.mjs
   Source = the inspironics folder one level up (originals + thumbs/ + full/). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "..");          // ../inspironics
const PUB = path.join(__dirname, "..", "public");

function copyInto(subdir, filterRe, destSub) {
  const from = subdir ? path.join(SRC, subdir) : SRC;
  const to = destSub ? path.join(PUB, destSub) : PUB;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(from)) {
    if (!filterRe.test(f)) continue;
    const s = path.join(from, f);
    if (fs.statSync(s).isFile()) { fs.copyFileSync(s, path.join(to, f)); n++; }
  }
  console.log(`copied ${n} -> public/${destSub || ""}`);
}

copyInto("thumbs", /\.webp$/i, "thumbs");
copyInto("full", /\.webp$/i, "full");
copyInto("", /\.(jpe?g|png)$/i, "");   // originals at public root, matching "x.jpg" references
console.log("Done. Image assets are now under public/.");
