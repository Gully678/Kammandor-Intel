# Kammandor Intelligence — marketing site

**Strictly Private & Confidential — INVRT.**

The public marketing site for the governed intelligence layer. Next.js 15 (App Router) ·
React 19 · TypeScript · Tailwind CSS · Framer Motion · a HyperFrames brand film.

Copy source of truth: `README_INTEL_ENGINE_MARKETING.md` (repo root of the Kammandor folder).
Claims discipline applies: ships-today only, no client names, no invented figures, UK English.
Design tokens: `Design Folder/KAMMANDOR_DESIGN_SCHEMA.md`, mapped 1:1 in `tailwind.config.ts`.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # production build (must be green before pushing)
```

## Deploy on Vercel

1. Push this folder to a GitHub repo (it is self-contained):
   ```bash
   git init && git add -A && git commit -m "Kammandor Intelligence site"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. In Vercel: **Add New → Project → Import** the repo. Framework preset **Next.js** is
   auto-detected. No environment variables are required.
3. Every push to `main` deploys. Point `www` / apex DNS at Vercel when ready.

## The brand film (HyperFrames)

`video/index.html` is a [HyperFrames](https://github.com/Gully678/hyperframes) composition —
plain HTML/CSS with a GSAP timeline, rendered deterministically to MP4 (13s, 1920×1080):

```bash
npm run render:video   # needs Node 22+, FFmpeg, and headless-Chrome download access
```

The MP4 lands at `public/video/kammandor-loop.mp4` and the site's film section plays it
automatically. **Until the file exists, the section plays an in-browser Framer Motion
version of the same storyboard — nothing looks broken either way.**

Preview the composition live while editing: `cd video && npx hyperframes preview`.

## Structure

```
src/app/          layout (fonts, metadata), page, global styles
src/components/   one component per section; 'use client' only on animated leaves
src/lib/          all copy/content in content.ts (single place to edit claims)
video/            HyperFrames brand-film composition + render script
```

## House rules for edits

- Never claim roadmap items (forecasting, licensed feeds, webhooks, self-host GA) as live.
- Never name clients. Never invent a figure or a price.
- Say "self-hostable today", never "self-host GA".
- UK English. Every fact on the page should be able to carry its receipt.
