# ⇄ ConvertHub — All-in-One File Converter Website

ConvertHub is a professional, production-ready converter website with **125+ tools** in one place:
images, PDF, Word/PowerPoint/Excel, spreadsheets & data, audio, video, archives, utilities — and **private AI**.

Its biggest advantage over typical converter sites: **most conversions run inside the visitor's browser**
(WebAssembly). Files are not uploaded, so the site is **private, fast and costs you almost nothing to host**,
even with thousands of users. Only Office documents (Word/PowerPoint → PDF) and the AI tools use your server.

---

## 🆕 What was done in v2 (2 Oct 2026) — READ THIS FIRST

This section is the owner's handbook. It explains **everything that was added**, where it lives, how to check it,
and what you can do next. Nothing here needs programming knowledge.

### 0. Quick start on this computer

```powershell
cd C:\Users\info\Downloads\ConvertHub\converthub
npm start
```

Then open **http://localhost:7683** (the port is set in `.env` → `PORT=7683`, chosen because nothing else uses it).
The startup banner tells you the state of every part:

```
  ➜ Local:   http://localhost:7683
  ➜ Tools:   125
  ➜ Office:  not available — Word/PPT→PDF will use fallbacks (see README)   ← install LibreOffice to fix
  ➜ MySQL:   recording to "converthub" ✓
  ➜ AI:      Ollama ✓ (qwen2.5:3b) · Whisper ✓
  ➜ Admin:   http://localhost:7683/admin
```

Settings live in `.env` (already created for this machine). `.env.example` documents every variable.

### 1. New design — dark by default, Indian identity, animated

| What | Details |
|---|---|
| **Dark mode default** | Every visitor starts in dark mode. The 🌙/☀️ button (top right) switches to light; the choice is remembered in the browser. |
| **Indian identity** | Saffron–white–green line at the very top, saffron accent colour on AI features, "Made with ❤️ in India 🇮🇳" in the footer, `₹0` pricing, Indian number formatting (`1,00,000`), Hindi-friendly font stack. |
| **Animations** | Slow-drifting aurora background, shimmering gradient headline that rotates words ("any file → PDF → photos → … → with AI"), cards that lift and glow on hover, sections that fade in as you scroll, animated progress bars, pulsing "live" dot, a format marquee, bouncing upload icon when you drag a file, **confetti 🎉 when a conversion succeeds**. Everything respects the OS "reduce motion" setting. |
| **Smart Drop (home page)** | "Not sure which tool? Drop any file here" — detects the file type and shows the 8 tools that can handle it. Pick one and the file is already loaded on the tool page. Nothing is uploaded. |
| **Command palette** | Press **Ctrl + K** anywhere → instant fuzzy search over all tools. Type a sentence and press **Tab** (or Enter with no match) → the AI picks the right tool. |
| **✨ Ask AI button** | In the big search box. Understands English, Hindi, Hinglish and Marathi: "mere photo ko chhota karna hai", "पीडीएफ को वर्ड में बदलना है", "4 pdf ek saath jodna hai". |
| **Favourites** | ☆ on every tool card. Saved tools appear first in search and in a "My favourites" tab on the home page. Stored only in the visitor's browser. |
| **🕘 History page** (`/history`) | List of the visitor's own recent conversions (tool, files, size, time) with a "Use again" button. Browser-only; files are never stored. |
| **Live counters** | "files converted" and "MB processed" on the home page animate up from real numbers in the database. "🔥 Trending" badges mark the most used tools of the last 30 days. |
| **Result panel** | Text results (AI, checksums, transcripts) are shown inline with **Copy** and **Share** (mobile share sheet) buttons besides Download. |
| **Feedback** | After every successful conversion a ⭐ 1–5 rating + optional comment appears. Goes straight to the database (`feedback` table). |
| **Mobile** | Fully responsive — tested at 390 px wide. |

### 2. MySQL database — everything is recorded (metadata only)

The site now writes to your **local MySQL 8** (`mysql8` Docker container, 127.0.0.1:3306 — the same one
you see as *localmysql* in Navicat). On first start it **creates a brand-new database called `converthub`**;
no other database is touched. **File contents are never stored** — only names, sizes, types and timings.
IP addresses are never stored either (only a one-way SHA-256 hash).

Open **Navicat → localmysql → converthub** and you will see:

| Table | What each row is |
|---|---|
| `sessions` | One anonymous visitor (browser). Device, browser, OS, language, timezone, screen size, theme, referrer, UTM tags, first/last seen, number of visits. |
| `page_views` | Every page opened, with tool id / category. |
| `conversions` | **One row per conversion job**: tool, category, engine, where it ran (`browser` / `server` / `ai`), options chosen, how many files, bytes in/out, from→to format, duration, success/error, error message. |
| `files` | **Every uploaded (input) and produced (output) file**: name, extension, MIME type, size, linked to its conversion. |
| `downloads` | Every Download / ZIP / Copy click. |
| `searches` | What people typed in search (header, hero, palette, AI, smart drop), how many results, which tool they picked. |
| `events` | UI events: theme change, favourite add/remove, share, palette open, files added. |
| `ai_requests` | Every AI call: feature, model, characters in/out, target language, duration, success/error. |
| `feedback` | Star ratings and comments. |
| `error_logs` | Browser and server errors with stack traces. |

Ready-made **views** (double-click in Navicat for an instant report):

| View | Answers |
|---|---|
| `v_daily_summary` | Conversions, success/fail, unique users, MB processed — per day |
| `v_tool_popularity` | Runs, success rate, unique users, avg seconds — per tool |
| `v_format_pairs` | Most requested from→to conversions (e.g. `jpg → png`) |
| `v_hourly_activity` | Which hours of the day are busiest |
| `v_recent_activity` | Latest conversions joined with device/browser |
| `v_missing_tools` | **Searches that found nothing** → the tools you should build next |

If MySQL is stopped, the website keeps working normally; it just stops recording. Turn recording off with `DB_ENABLED=false`.

### 3. Admin dashboard — http://localhost:7683/admin

Key = the `ADMIN_KEY` value in your `.env`. Shows live KPIs (conversions, visitors online now,
page views, data in/out, success rate, downloads, AI requests, average rating, errors), a per-day chart,
most used tools, format pairs, busiest hours, devices & browsers, top searches, **"searched but not found"**,
AI usage, latest feedback, recent conversions and recent errors. Switch 7/14/30/90 days at the top right.
The page is blocked from search engines (`robots.txt`).

### 4. ✨ AI features — 100 % private, run on your own machine

All AI runs locally in Docker containers that are already on this PC: **Ollama** (`qwen2.5:3b`, port 11434)
for text, **Whisper** (port 9000) for speech. **Nothing is sent to OpenAI, Google or any cloud.**
New category "✨ AI Tools" (`/category/ai`) with 7 tools:

| Tool | What it does |
|---|---|
| **AI Summarize Document** | PDF / Word / text → short, medium or detailed summary, in 17 languages |
| **AI Translate Document** | PDF / Word / text → Hindi (default), Marathi, Tamil, Telugu, Gujarati, Bengali, Kannada, Malayalam, Punjabi, Urdu, English, French, German, Spanish, Arabic, Chinese, Japanese |
| **AI Key Points & Action Items** | Long notices / reports / minutes → bullet list + "Action items" with deadlines |
| **AI Simplify (Plain Language)** | Legal notices, government circulars → simple language |
| **AI Ask Your Document** | Any instruction: "list every date and amount", "make a quiz from this chapter", "write a reply email" |
| **AI Audio/Video to Text** | MP3 / WAV / MP4 / … → transcript (TXT / SRT / VTT / JSON). Auto-detects Indian languages; can translate speech to English |
| **AI Generate Subtitles (SRT)** | Video → ready-to-upload SRT subtitles with timestamps (YouTube / Instagram / lectures) |

Plus the **AI tool finder** (Ask AI / Ctrl+K → Tab) — a hybrid: the model translates the wish into English
keywords, then a deterministic scorer picks tools from the catalog, so results are always valid tool ids and it
still works (keyword-only) if Ollama is down. Devanagari words (पीडीएफ, फोटो, छोटा, जोड़, अनुवाद …) are mapped
directly, so Hindi/Marathi script works even without the model.

How text AI protects privacy: the **text is extracted inside the browser** (PDF.js / mammoth) and only the text is
sent to your server → Ollama. For speech, the media file is uploaded to your server → Whisper and deleted right after.
Long documents are split into ~7 000-character chunks and the partial summaries are merged (map-reduce).
Limits: `AI_MAX_INPUT_CHARS=60000`, `AI_RATE_LIMIT_PER_HOUR=40` per IP.

**Speed note:** this PC has no GPU, so the 3B model runs on CPU: tool finder ≈ 5–15 s, a one-page summary ≈ 1 min.
The server warms the model at startup and keeps it loaded for 2 h so the first visitor doesn't wait for loading.
For a real launch use a GPU server, or a bigger/faster model via `OLLAMA_MODEL` (e.g. `qwen2.5:7b`, `gemma2:9b`).
If Ollama/Whisper are off, the AI pages show a clear notice and everything else keeps working.

Start the AI containers if they are stopped: `docker start superedulab_ollama superedulab_whisper`.

### 4b. 📁 File archive → your Google Drive (added 2 Oct 2026, afternoon)

By default ConvertHub stores **only metadata** about files, never the files themselves. The archive is an
**opt-in switch** that keeps a real copy of every input and output file so you can download them later.
It is **ON in your `.env`** (`ARCHIVE_FILES=true`).

**How it works**

1. When a conversion finishes, the browser quietly sends a copy of the input file(s) and the result to **your server**
   (never to a third party). Files above `ARCHIVE_MAX_FILE_MB` (50 MB) are skipped.
2. The server saves them on local disk first: `D:\converthub-archive\YYYY\MM\DD\<conversion-id>\input-….jpg` and `output-….png`.
   This is instant and never fails because Drive is slow or offline.
3. A background queue uploads each file to **your Google Drive** folder
   (the folder whose id is in `GDRIVE_FOLDER_ID`) as
   `ConvertHub/2026-10-02/<conversion-id>/input-….jpg`. The Drive link is written back to MySQL (`files.drive_url`).
   If Drive is down or not yet logged in, files wait on disk and are uploaded automatically when the server starts next time.
4. `ARCHIVE_KEEP_DAYS=0` → **nothing is ever deleted** (your choice). If you ever set a number, a daily sweeper deletes local + Drive copies older than that.


**Where to download**

* **Admin dashboard → Recent conversions → Files column**: green **⬇ in / ⬇ out** buttons download the local copy
  (or jump to the Drive file if the local copy has expired).
* **Navicat → converthub → files**: columns `storage_path` (local), `drive_url` (clickable Drive link), `archived_at`.
* **Google Drive**: open your folder → `ConvertHub` → date → conversion id.
* Dashboard card **📁 File archive** shows: files archived, uploaded to Drive, disk used, retention, upload queue, and the exact error if Drive isn't connected.

**One-time Google login (you must do this — only you can log into your Google account)**

rclone is already installed (`winget install Rclone.Rclone` was run). Open a **new** PowerShell window and run:

```powershell
rclone config create gdrive drive scope=drive root_folder_id=<YOUR_DRIVE_FOLDER_ID>
```

A browser window opens → choose your Google account → click **Allow**. Back in PowerShell you'll see the token saved. Check:

```powershell
rclone lsd gdrive:        # should list the contents of your ConvertHub Drive folder (may be empty)
```

Then restart ConvertHub (`npm start`). The banner should say `➜ Drive: connected ✓ → gdrive:ConvertHub`, and the 2 files
already waiting on disk will be uploaded within a minute.

✅ **Done on 2 Oct 2026 15:26** — login completed, `Drive: connected ✓`, first files visible in the Drive folder, links in `files.drive_url`.

⚠️ **Before deploy — make your own Google client ID (5 min, free).** rclone warns that its *shared* Google Drive app
"is being retired and will stop working during 2026". Follow <https://rclone.org/drive/#making-your-own-client-id>
(Google Cloud Console → OAuth client → paste `client_id` / `client_secret` into `rclone config` → `rclone config reconnect gdrive:`).
Until then files are always safe on local disk and auto-upload once Drive works again.

🔐 **Never paste `rclone config` output anywhere** (chat, email, screenshots) — it contains your Drive refresh token, which
is a full-access key to your Drive. If it leaked, run `rclone config reconnect gdrive:` to issue a new one (the old one dies).

**Drive folder sharing — what to set**

Set the folder to **Restricted (only you)**. Do **not** use "Anyone with the link" and never "editor".
The folder will hold visitors' private documents; the server uploads as *you*, so it needs no public access.
If the folder is currently public, change it in Drive → right-click → Share → General access → **Restricted**.

**Honesty to visitors (done automatically when the archive is on)**

* The tool badge changes to "🔒 Converted in your browser · a copy is kept for 30 days".
* The Privacy page gets a "File archive" paragraph.
* Turn the archive off (`ARCHIVE_FILES=false`) and both revert — the site is back to "no upload".

**Settings**

| Variable | Default here | Meaning |
|---|---|---|
| `ARCHIVE_FILES` | `true` | Master switch |
| `ARCHIVE_DIR` | `D:\converthub-archive` | Local folder (D: has ~145 GB free) |
| `ARCHIVE_KEEP_DAYS` | `0` | **0 = keep forever (your setting).** Any other number = delete after N days |
| `ARCHIVE_MAX_FILE_MB` | `50` | Bigger files are not archived (saves bandwidth; videos are big) |
| `GDRIVE_ENABLED` | `true` | Upload to Drive (false = local disk only) |
| `GDRIVE_REMOTE` | `gdrive` | rclone remote name |
| `GDRIVE_FOLDER` | `ConvertHub` | Sub-folder created inside your Drive folder |
| `GDRIVE_FOLDER_ID` | *(your folder id)* | Your Drive folder id (from the link) — used for dashboard links |

Verified: real conversion → `D:\converthub-archive\2026\10\02\4\input-test.jpg` + `output-test.png` on disk →
rows 7 & 8 in `files` → admin ⬇ link returns the file (HTTP 200, 134 bytes) → privacy text shown. Drive upload is
pending only the login above.

### 4c. 🚀 Deploying — Vercel vs a real server (read before choosing)

ConvertHub has **two halves**:

| Half | Needs | Works on Vercel? |
|---|---|---|
| **115+ browser tools** (image, PDF, Excel, audio, video, ZIP, PDF→Word…) | Just static files | ✅ Yes — perfectly |
| **Server features**: MySQL analytics + admin dashboard, AI (Ollama/Whisper), Google Drive archive, LibreOffice Office→PDF | A machine that runs 24×7 with those services on it | ❌ No — Vercel is "serverless": no MySQL, no Docker, no disk, functions die after each request |

**Vercel (`vercel.json` + `api/index.js`, added 2 Oct 2026)** — the repo now deploys cleanly: static files go to Vercel's CDN,
Express runs as a function, and `server.js` detects `VERCEL` and switches the server-only features off automatically
(cold start ≈ 0.7 s, verified locally). Your site works as a fast, free, privacy-first converter — analytics/AI/archive
simply show "not available" notices. **Do not commit `.env`** — it is laptop-specific (D:\ paths, 127.0.0.1 services) and
would break the Vercel function. Set variables in Vercel → Project → Settings → Environment Variables if you later point
`DB_HOST` at a cloud MySQL (PlanetScale/Aiven) or `OLLAMA_URL` at a GPU box.

**Full features = VPS** (Hostinger / DigitalOcean / Hetzner, ₹400–800/month, Ubuntu). Follow "Deploy → Option A" below.
On that server: `sudo apt install mysql-server libreoffice rclone`, install Ollama (`curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5:3b`),
copy your `.env` and edit `DB_*`, `ARCHIVE_DIR=/var/converthub-archive`, and **copy your Drive login** so the archive
reconnects without a browser: from this PC copy `C:\Users\info\AppData\Roaming\rclone\rclone.conf` to the server's
`~/.config/rclone/rclone.conf` (e.g. with WinSCP). Then `rclone lsd gdrive:` on the server should list your folder.
(I could not automate this copy — it is your Google token, and the tooling rightly refuses to move credentials around.)

### 5. Other new tools & fixes

* **PDF to Word (DOCX)** — new, fully in-browser, keeps text and paragraph structure (the #1 missing converter in India).
* Translate tool defaults to **Hindi**.
* Health endpoint `/api/health` now reports `db` and `ai` status; `/api/stats` gives public counters.
* Browser errors and server errors are logged to `error_logs` so you can see what breaks for real users.

### 6. Files that were added / changed

```
.env                      ← your local settings (port 7683, MySQL, admin key, AI URLs) — not in git
src/db.js                 ← MySQL layer: creates DB + 10 tables + 6 views, all write/read helpers
src/archive.js            ← file archive: local disk + Google Drive (rclone) upload queue, retention sweeper
src/ai.js                 ← Ollama + Whisper client: tool finder, text tasks, transcription, warm-up
server.js                 ← new routes: /api/track/*, /api/feedback, /api/stats, /api/admin/summary,
                             /api/ai/find-tool, /api/ai/text, /api/ai/transcribe, pages /history and /admin
public/js/track.js        ← anonymous tracking client + local history
public/js/engines/ai.js   ← browser side of AI tools (text extraction, calls to /api/ai/*)
public/js/engines/pdf.js  ← + pdfToWord
public/js/tools.js        ← + AI category and 7 AI tools, PDF to Word
public/js/app.js          ← redesigned UI, smart drop, palette, favourites, history, admin dashboard, confetti, feedback
public/css/style.css      ← complete new design system (dark-first, aurora, glass, animations)
public/index.html         ← dark default, tricolor line, aurora, new nav (✨ AI, History)
public/js/theme.js        ← dark is the default
```

### 7. Verified working (2 Oct 2026)

Automated end-to-end run in headless Chrome, zero JavaScript errors: real JPG→PNG conversion → result shown →
feedback sent → row in `conversions`/`files`/`downloads`/`feedback`; Ctrl+K palette; Smart Drop suggestions;
theme toggle persists; History page; Admin dashboard login + all panels; mobile layout (390 px).
AI: summarise (Mumbai University notice → correct 4-sentence summary), tool finder on 11 Hinglish/Hindi/Marathi
queries (all correct top result), Hindi text stored correctly in MySQL (utf8mb4).

### 8. Ideas you can do next (no code changed yet)

* **Image to Text (OCR)** with Tesseract.js (in-browser) — scanned Aadhaar/marksheets → text; then the AI tools work on scans too.
* **AI image tools**: background remover, passport-photo maker (Indian 35×45 mm, white background, 10–50 KB for government forms).
* **UPI "Buy me a chai"** / premium tier for bigger server conversions.
* Hindi/Marathi **UI translation** (labels) — the structure is ready, only strings needed.
* WhatsApp share button on results (already have Web Share on mobile).
* Deploy on a GPU VPS so AI responses take 1–3 s instead of 10–60 s.

---

## 📑 Contents
1. [Features](#-features)
2. [How it works (architecture)](#-how-it-works-architecture)
3. [Requirements](#-requirements)
4. [Installation & setup (step by step)](#-installation--setup-step-by-step)
5. [Enable Office conversions (LibreOffice)](#-enable-office-conversions-libreoffice)
6. [Configuration (.env)](#%EF%B8%8F-configuration-env)
7. [Project structure](#-project-structure)
8. [Add your own converter](#-add-your-own-converter)
9. [Deploy to the internet](#-deploy-to-the-internet)
10. [Troubleshooting](#-troubleshooting)
11. [Limitations](#%EF%B8%8F-known-limitations)
12. [Ideas to grow the business](#-ideas-to-grow-the-business)

---

## ✨ Features

| Category | Tools |
|---|---|
| 🖼️ **Image** | Universal image converter, 24 direct pairs (JPG↔PNG, WEBP→PNG/JPG, HEIC→JPG/PNG, SVG→PNG/JPG, PNG→ICO favicon, AVIF/TIFF/BMP/GIF→PNG/JPG, PNG/JPG→GIF…), Resize, Compress, Rotate & Flip, Black & White, Remove EXIF/GPS metadata |
| 📕 **PDF** | PDF→JPG, PDF→PNG, JPG/PNG/Image→PDF, Merge, Split (every page / every N pages / ranges), Extract pages, Remove pages, Reorder pages, Rotate, Compress, PDF→Text, Watermark, Page numbers |
| 📝 **Documents** | Word→PDF, PowerPoint→PDF, Excel→PDF, Office→PDF, DOC→DOCX, ODT↔DOCX, RTF→DOCX, PPT→PPTX (server), Word→HTML, Word→Text, Markdown→HTML, HTML→Text, Text→PDF |
| 📊 **Excel & Data** | Universal spreadsheet converter, Excel↔CSV, Excel↔JSON, CSV↔JSON, XLS↔XLSX, ODS↔XLSX, Excel→HTML, CSV→TSV (multi-sheet + Unicode support) |
| 🎵 **Audio** | Universal audio converter, 14 pairs (MP3↔WAV, M4A/AAC/OGG/FLAC/OPUS/WMA→MP3…), Audio cutter, bitrate / sample-rate / mono-stereo / volume / trim |
| 🎬 **Video** | Universal video converter, 16 pairs (MP4↔WEBM, MOV/AVI/MKV/FLV/WMV/3GP→MP4, MP4→GIF, GIF→MP4…), Video→GIF, Compress video, Trim, Remove audio, Video→MP3, Extract audio |
| 🧰 **Archive & Utilities** | Create ZIP, Extract ZIP, File→Base64, Base64→File, SHA-1/256/512 checksums |

**Website features**
- Batch conversion with a queue, per-file progress bars, error messages and size savings (e.g. “72% smaller”)
- Drag & drop anywhere on the page, click to browse, or **paste with Ctrl+V**
- Previews of results (images, audio and video players), **Download all as ZIP**
- Instant tool search (press <kbd>/</kbd>), categories, popular tools, related tools, FAQ
- **Dark / light mode** (remembers choice, follows the OS by default)
- **SEO-ready**: real URL per tool (`/tools/jpg-to-png`) with its own title + description, canonical tags,
  Open Graph, JSON-LD, auto-generated `sitemap.xml` and `robots.txt`
- Responsive (mobile, tablet, desktop), keyboard accessible, reduced-motion support, PWA manifest
- **Security**: strict Content-Security-Policy, cross-origin isolation, no-sniff, frame protection,
  upload size limit, file-type whitelist, rate limiting, concurrency limit, timeouts, automatic temp-file cleanup
- Graceful fallbacks: Word→PDF still works (text-only) when LibreOffice is missing; Safari WEBP via FFmpeg;
  exotic image formats (TIFF…) decoded with FFmpeg

---

## 🧠 How it works (architecture)

```
 Browser (visitor)                                   Your server (Node.js + Express)
 ┌────────────────────────────────────────────┐      ┌──────────────────────────────────┐
 │ app.js  → router, UI, queue, options       │      │ server.js                        │
 │ tools.js → catalog of all 120+ tools  ◄────┼──────┤  • SEO pages /tools/:id          │
 │ engines/ (loaded only when needed)         │      │  • sitemap.xml, robots.txt       │
 │   image.js  Canvas + HEIC + ICO/BMP encoder│      │  • security headers (COOP/COEP)  │
 │   pdf.js    pdf-lib + PDF.js               │      │  • /api/convert/office ──► LibreOffice
 │   sheet.js  SheetJS                        │◄────►│     (Word/PPT/Excel → PDF/DOCX)  │
 │   media.js  FFmpeg (WebAssembly)           │      │  • /api/health                   │
 │   doc.js    mammoth + Markdown + upload    │      └──────────────────────────────────┘
 │   files.js  JSZip + Base64 + Web Crypto    │
 └────────────────────────────────────────────┘
```

- `public/js/tools.js` is the **single source of truth**. The browser uses it to build the UI, the server
  uses the same file to create SEO pages and the sitemap.
- Heavy libraries (FFmpeg ~30 MB, PDF.js, SheetJS…) are **lazy-loaded** only when a tool needs them,
  so the homepage loads fast.
- All libraries are served from **your own domain** (`public/vendor`, created automatically by `npm install`).

---

## 📋 Requirements

| Software | Version | Needed for |
|---|---|---|
| **Node.js** | 18.17 or newer (20 LTS / 22 LTS recommended) | Running the website |
| **npm** | comes with Node.js | Installing packages |
| **LibreOffice** | 7.x or newer — *optional* | Word / PowerPoint / Excel → PDF with perfect layout |
| A modern browser | Chrome, Edge, Firefox, Safari, Brave, Opera | Using the site |

Internet access is required **once** during `npm install` to download the packages.

---

## 🚀 Installation & setup (step by step)

### Step 1 — Install Node.js
- **Windows / macOS:** download the **LTS** installer from <https://nodejs.org> and install it (keep the default options).
- **Ubuntu / Debian:**
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
Check it works (open a new terminal):
```bash
node -v    # should print v18.17+ (e.g. v22.x.x)
npm -v
```

### Step 2 — Extract the ZIP
Extract `ConvertHub.zip`. You will get a folder named **`converthub`**.
Tip: put it somewhere simple, e.g. `C:\projects\converthub` or `~/projects/converthub`.

### Step 3 — Open a terminal inside the folder
- **Windows:** open the `converthub` folder in File Explorer → click the address bar → type `cmd` → Enter.
  (Or right-click inside the folder → *Open in Terminal*.)
- **macOS:** right-click the folder → *Services* → *New Terminal at Folder*.
- **Linux:** `cd ~/projects/converthub`

### Step 4 — Install dependencies
```bash
npm install
```
This downloads everything and automatically copies the browser libraries into `public/vendor`.
At the end you should see: `All browser libraries are ready in public/vendor ✓`

### Step 5 — (Optional) create your settings file
```bash
# Windows
copy .env.example .env
# macOS / Linux
cp .env.example .env
```
The defaults work fine for local use — you can skip this step.

### Step 6 — Start the website
```bash
npm start
```
You will see:
```
  ConvertHub v1.0.0 is running
  ➜ Local:   http://localhost:7683
```

### Step 7 — Open it
Open **http://localhost:7683** in your browser. 🎉

> ⚠️ Always open the site through `npm start` (http://localhost:7683).
> Double-clicking `index.html` will **not** work — the converters need the server's security headers.

For development with auto-restart on file changes use `npm run dev`.
To stop the server press <kbd>Ctrl</kbd> + <kbd>C</kbd>.

---

## 📄 Enable Office conversions (LibreOffice)

Tools marked **“Server”** (Word→PDF, PowerPoint→PDF, Excel→PDF, DOC→DOCX…) need LibreOffice
installed on the computer/server that runs ConvertHub. Everything else works without it.

| OS | Install |
|---|---|
| **Windows** | Download from <https://www.libreoffice.org/download/> and install. It is detected automatically at `C:\Program Files\LibreOffice\program\soffice.exe`. |
| **macOS** | `brew install --cask libreoffice` (or download the .dmg) |
| **Ubuntu/Debian** | `sudo apt-get install -y libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu fonts-liberation` |

Restart ConvertHub (`npm start`). The console should show `Office: enabled (...)`.
If LibreOffice is installed in a custom location, set `SOFFICE_PATH` in `.env`.

**Tip for Indian languages / Hindi / Marathi / other scripts:** install extra fonts on the server
(e.g. `sudo apt-get install fonts-noto fonts-noto-cjk`) so documents render correctly in PDF.

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to run on (this machine uses `7683`) |
| `HOST` | `0.0.0.0` | `127.0.0.1` = only this computer |
| `SITE_URL` | *(empty)* | Your public URL, e.g. `https://convert.example.com` (used in sitemap & canonical links) |
| `MAX_UPLOAD_MB` | `100` | Max upload size for server conversions |
| `ENABLE_OFFICE_CONVERSION` | `true` | Turn server conversions on/off |
| `SOFFICE_PATH` | *(auto)* | Full path to LibreOffice `soffice` |
| `OFFICE_TIMEOUT_SECONDS` | `180` | Kill a conversion after this time |
| `MAX_CONCURRENT_JOBS` | `2` | Parallel LibreOffice conversions (raise on bigger servers) |
| `RATE_LIMIT_PER_HOUR` | `60` | Server conversions per IP per hour |
| `TRUST_PROXY` | `false` | Set `true` behind Nginx / Cloudflare so rate limiting sees real IPs |
| `DB_ENABLED` | `true` | Record usage analytics + file metadata to MySQL (`false` = record nothing) |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MySQL server |
| `DB_USER` / `DB_PASSWORD` | `root` / *(empty)* | MySQL login |
| `DB_NAME` | `converthub` | Database name — created automatically |
| `IP_HASH_SALT` | *(string)* | Visitor IPs are stored only as SHA-256(IP + salt) |
| `ADMIN_KEY` | *(empty = disabled)* | Key for the `/admin` dashboard |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Local LLM server for text AI |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Model name (falls back to the first installed model) |
| `WHISPER_URL` | `http://127.0.0.1:9000` | Local speech-to-text server |
| `AI_TIMEOUT_SECONDS` | `180` | Give up on an AI call after this |
| `AI_MAX_INPUT_CHARS` | `60000` | Longer documents are cut (user is told) |
| `AI_RATE_LIMIT_PER_HOUR` | `40` | AI calls per IP per hour |

---

## 📁 Project structure

```
converthub/
├── server.js                 # Express server: SEO pages, security headers, Office API, sitemap
├── package.json              # Dependencies & scripts (npm start / npm run dev)
├── .env.example              # Settings template → copy to .env
├── scripts/
│   └── copy-vendor.js        # Copies browser libraries to public/vendor (runs after npm install)
├── deploy/
│   ├── nginx.conf            # Reverse-proxy config for a VPS
│   └── ecosystem.config.cjs  # PM2 config (keeps the site running 24/7)
├── Dockerfile                # Production image incl. LibreOffice
├── docker-compose.yml
└── public/
    ├── index.html            # Page shell (title/description injected per page by server)
    ├── css/style.css         # Design system, dark mode, responsive layout
    ├── favicon.svg, manifest.webmanifest
    ├── vendor/               # ← auto-generated, do not edit
    └── js/
        ├── app.js            # SPA: router, home/category/tool pages, queue, options, results
        ├── tools.js          # ★ Catalog of all tools (edit this to add/remove tools)
        ├── utils.js          # Helpers (safe DOM builder, page ranges, downloads, toasts)
        ├── theme.js          # Dark/light mode before first paint
        └── engines/
            ├── image.js      # Images (Canvas, HEIC, ICO & BMP encoders)
            ├── pdf.js        # PDF tools (pdf-lib + PDF.js)
            ├── sheet.js      # Spreadsheets (SheetJS)
            ├── media.js      # Audio & video (FFmpeg WebAssembly)
            ├── doc.js        # Office (server), DOCX (mammoth), Markdown, HTML
            └── files.js      # ZIP, Base64, checksums
```

---

## ➕ Add your own converter

Example: a **“WEBP to GIF”** tool.

1. Open `public/js/tools.js` and add an entry (or just add `['webp','gif']` to `IMG_PAIRS`):
   ```js
   add({
     id: 'webp-to-gif', cat: 'image', title: 'WEBP to GIF',
     desc: 'Convert WEBP images to GIF.',
     accept: '.webp', engine: 'image', fn: 'convert', params: { to: 'gif' },
   });
   ```
2. Restart the server. The tool automatically gets its own page `/tools/webp-to-gif`, appears in search,
   its category and the sitemap.

For a brand-new kind of conversion, export a new function from an engine file:
```js
// signature for mode 'each':  (file, options, ctx) => [{ name, blob }]
// signature for mode 'all':   (files[], options, ctx) => [{ name, blob }]
export async function myTool(file, o, ctx) {
  ctx.log('Working…'); ctx.progress(0.5);
  return [{ name: 'result.txt', blob: new Blob(['hello']) }];
}
```
Option types available: `select`, `number`, `text`, `checkbox`, `range`, `color` — with `default`,
`required`, `help` and `showIf: { optionId: ['value1','value2'] }` for conditional options.

---

## 🌍 Deploy to the internet

> ConvertHub needs a **Node.js server** (not plain static hosting) because it sends special security headers
> and serves SEO pages. Good options: a VPS (DigitalOcean, Hetzner, AWS Lightsail, Hostinger VPS),
> Render, Railway or Fly.io.

### Option A — Ubuntu VPS (recommended, full features)
```bash
# 1. Install Node.js 22, LibreOffice, Nginx, PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu fonts-liberation fonts-noto
sudo npm install -g pm2

# 2. Upload the project (scp / git / SFTP) to /var/www/converthub, then:
cd /var/www/converthub
npm install --omit=dev
cp .env.example .env
nano .env        # set SITE_URL=https://yourdomain.com and TRUST_PROXY=true

# 3. Run 24/7 and start on boot
pm2 start deploy/ecosystem.config.cjs
pm2 save && pm2 startup

# 4. Nginx + free HTTPS
sudo cp deploy/nginx.conf /etc/nginx/sites-available/converthub
sudo nano /etc/nginx/sites-available/converthub     # replace example.com with your domain
sudo ln -s /etc/nginx/sites-available/converthub /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```
Point your domain's DNS **A record** to the server IP before running certbot.

### Option B — Docker (includes LibreOffice)
```bash
docker compose up -d --build
# site runs on http://SERVER_IP:3000  (put Nginx/HTTPS in front for production)
```

### Option C — Render / Railway (no server management)
- Create a new **Web Service** from your Git repository.
- Build command: `npm install` — Start command: `npm start`
- Add environment variable `SITE_URL` (and `TRUST_PROXY=true`).
- Or choose **Docker** deploy to get LibreOffice included (uses the provided `Dockerfile`).

### After going live
- Submit `https://yourdomain.com/sitemap.xml` in **Google Search Console** and Bing Webmaster Tools.
- HTTPS is required in production (browser crypto/clipboard features need a secure context).

---

## 🛠 Troubleshooting

| Problem | Fix |
|---|---|
| `'npm' is not recognized` | Node.js is not installed or the terminal was opened before installing. Reinstall Node.js and open a **new** terminal. |
| `Port 7683 is already in use` | Set another `PORT` in `.env` (or stop the other program). |
| Warnings about `canvas` during `npm install` (Windows) | Harmless — it's an optional package of PDF.js. Or install with `npm install --omit=optional`. |
| “Failed to load /vendor/...” in the site | Run `npm run vendor` (or delete `node_modules` and run `npm install` again). |
| Video/audio tools stuck on “Loading FFmpeg” | Open the site via `http://localhost:7683` (not by double-clicking a file), hard-refresh with Ctrl+F5, and check the browser console. |
| Word→PDF output is text-only | LibreOffice isn't installed/detected — see [Enable Office conversions](#-enable-office-conversions-libreoffice). |
| Big video crashes the tab | Browser memory limit (~2 GB). Use “Compress video” at 720p, or trim first. Desktop Chrome/Edge handle the largest files. |
| `413 File is too large` after deploying | Increase `MAX_UPLOAD_MB` in `.env` **and** `client_max_body_size` in Nginx. |
| PDF tools say “password-protected” | Unlock the PDF first; encrypted PDFs aren't supported. |

---

## ⚠️ Known limitations
- Browser-side video conversion is slower than a native desktop app on very long videos (it is single-threaded
  WebAssembly for maximum compatibility). Short/medium videos convert comfortably.
- “Compress PDF” re-renders pages as optimized images (great for scans; text is no longer selectable).
- Text→PDF uses standard PDF fonts (Latin characters). For other scripts convert via Word→PDF with LibreOffice.
- PDF→Word and OCR (scanned PDF → text) are not included; they need heavy server-side engines.
- HEIC decoding speed depends on the device (large iPhone photos can take a few seconds each).

---

## 💡 Ideas to grow the business
- **Monetisation:** tasteful ads (AdSense) on tool pages, or a Pro plan (bigger server limits, priority queue).
- **Analytics:** add a privacy-friendly tool such as Plausible or Umami (remember to allow its domain in the CSP in `server.js`).
- **More server engines:** PDF→Word, OCR (Tesseract), e-books (Calibre), CAD, fonts — add new API routes like `/api/convert/office`.
- **Languages:** translate `tools.js` titles/descriptions for Hindi, Marathi, Spanish… and serve `/hi/tools/...` pages for more SEO traffic.
- **Public API:** let developers convert files with API keys (paid tiers).

---

## 📜 License
MIT — free to use, modify and sell. Third-party libraries keep their own licenses
(FFmpeg.wasm — MIT core with LGPL/GPL codecs, PDF.js — Apache-2.0, pdf-lib — MIT, SheetJS CE — Apache-2.0,
JSZip — MIT/GPLv3, mammoth — BSD-2, heic2any — MIT). If you distribute FFmpeg builds commercially,
review the FFmpeg licensing notes.
