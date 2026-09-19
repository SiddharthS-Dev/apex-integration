# Inspironics Innovation Showcase — Full-Stack Edition

The exact stack from the brief: **Next.js 15 + React + Tailwind + Framer Motion** front end, an **Express** API, a **PostgreSQL** database, and an **OpenAI Vision** description pipeline.

> If you just want the running site without any setup, open `../index.html` — that's the fully working self-contained build. This folder is for hosting the platform on the proper stack.

## What's here

```
nextjs-app/
├─ app/                 # Next.js App Router (layout, page, global CSS)
├─ components/          # Gallery + FlipCard + Lightbox (Framer Motion 3D flip)
├─ server/              # Express API backed by Postgres (optional)
├─ db/                  # schema.sql + seed.js
├─ scripts/
│  ├─ copy-images.mjs           # copy thumbs/ full/ + originals into public/
│  └─ generate-descriptions.mjs # OpenAI Vision -> structured JSON (optional)
├─ data/showcase.json   # the 235-item dataset (works with no DB)
└─ public/              # image assets live here after copy-images
```

## Quick start (no database needed)

```bash
cd nextjs-app
npm install
node scripts/copy-images.mjs     # populate public/ with the images
npm run dev                      # http://localhost:3000
```

The front end reads `data/showcase.json` directly, so it runs immediately with the OCR-derived descriptions already generated.

## Optional: PostgreSQL + Express API

```bash
cp .env.example .env.local       # set DATABASE_URL
npm run db:schema                # create the table
npm run db:seed                  # load showcase.json into Postgres
npm run api                      # Express on http://localhost:4000
```

Then point the front end at the API by setting in `.env.local`:

```
NEXT_PUBLIC_DATA_SOURCE=http://localhost:4000/api/items
```

and switch `app/page.jsx` to `fetch()` that URL (a commented example is in the file).

API routes: `GET /api/items` (supports `?cat=&q=&tech=&esg=1&ai=1&iot=1`), `GET /api/items/:file`, `GET /api/meta`.

## Optional: real AI Vision descriptions

The bundled descriptions come from OCR + structured templates (plus hand-written copy for 25 flagship cards). To regenerate **every** card with true diagram-reading vision output:

```bash
# set OPENAI_API_KEY in .env.local
node scripts/copy-images.mjs     # ensure public/images exists, or set IMAGES_DIR
IMAGES_DIR=../ npm run ai:describe
```

This calls `gpt-4o` per image, reads the arrows/layers, and rewrites `data/showcase.json`. Re-run `npm run db:seed` afterwards if you're using Postgres.

## Features (parity with the static build)

3D flip cards (Framer Motion), glassmorphism + neon cyan/emerald on `#050816`, animated grid, search, category/technology/ESG/AI/IoT filters, sort, fullscreen lightbox, related infographics, prev/next, lazy in-view reveal, mobile responsive.
