# Design-to-Dev Handoff Agent

> **Design ka screenshot do, dev-ready code lo.**

A personal AI-powered tool that converts design screenshots, GIFs, and website references into developer-ready specs and runnable code — using plain Hinglish instructions. No coding knowledge required to operate it.

---

## The Core Idea

You want to build visually stunning websites with unique interactions — without needing to know how to code the animations yourself.

**The old way:**
1. See a cool animation somewhere
2. Try to describe it to a developer (or an AI tool like Claude Code / Cursor)
3. Get back generic code that doesn't match what you imagined
4. Repeat 10 times

**With this tool:**
1. Upload a screenshot / GIF of the interaction you like
2. Type a vague instruction in Hinglish — *"yaar ye globe wala rotate karo smoothly, dark bg chahiye"*
3. Get back:
   - A **technical spec** (readable by developers AND AI tools like Claude Code, Cursor)
   - **Runnable HTML/CSS/GSAP code** (copy-paste and it works in a browser)

---

## Project Status

| Phase | Status |
|---|---|
| UI structure built | ✅ Done |
| File upload (image/GIF) | ✅ Done |
| Hinglish instruction input | ✅ Done |
| Output panel (specs + code tabs) | ✅ Done |
| Suggestions panel | ✅ Done |
| Gemini API connected | ✅ Done |
| URL / website reference input | ✅ Done |
| Live preview | ⏳ Next |
| Component memory | ⏳ Later |
| Difficulty rating | ⏳ Later |

---

## File Structure

```
design-to-dev-agent/
├── index.html     — The entire UI (single page app)
├── style.css      — Dark theme, all component styles
├── script.js      — All logic: upload, API calls, rendering
└── README.md      — This file
```

No build step. No npm. No server. Open `index.html` in a browser and it works.

---

## How to Run

1. Open `index.html` in any modern browser (Chrome recommended)
2. Add your Gemini API key (see below)
3. Start using

That's it. No installation, no terminal, no dependencies.

---

## Setting Up the Gemini API Key

The tool uses **Google Gemini 2.5 Flash** as its AI brain. You need a free API key.

### Getting a key
1. Go to [Google AI Studio](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **"Get API Key"** → **"Create API key"**
4. Copy the key (starts with `AIza...`)

### Adding it to the tool
1. Open the tool in your browser
2. Click **"Add Gemini Key"** button in the top-right of the header
3. Paste your key → click **Save**
4. The dot turns **green** — you're connected

The key is saved in your browser's `localStorage`. It never leaves your computer — it goes directly from your browser to Google's API. No server in between.

### To remove the key
Click "Add Gemini Key" → click "Remove key"

---

## Using the Tool

### Step 1 — Provide a design reference

Two ways:

**A) Upload a file**
- Drag & drop an image/GIF onto the upload zone
- Or click "browse files"
- Supported formats: PNG, JPG, GIF, WebP (up to 20 MB each)
- Multiple files supported — upload different angles/states of the same design

**B) Paste a URL**
- Click the **"Paste URL"** tab next to the upload zone
- Paste any website URL (e.g. `https://stripe.com`)
- Click **Fetch** — the tool will:
  1. Take a screenshot of the page
  2. Extract animation/interaction code from the page source
- Wait for "Got screenshot + source code ✓"
- Best for: referencing a live website whose animation you want to recreate

### Step 2 — Write your instruction

Type in the **Instructions** box in **any language** — Hinglish (Hindi + English mix) is fully supported and encouraged.

Examples:
- *"Ye globe rotate karo continuously, wireframe style, green dots ke saath"*
- *"Button click karne pe smooth slide-in chahiye, dark background, GSAP use karo"*
- *"Modal open/close animation, scale aur fade, 0.3s"*
- *"Hero section ka text stagger animation, ek ek word aaye"*

Be as vague or as specific as you want. The AI will ask for clarification if something is missing.

### Step 3 — Choose options

**Output Format:**
- `Specs + Code` — gives you both the technical spec table AND the runnable code (default)
- `Specs only` — just the design spec (useful for sharing with a developer)
- `Code only` — just the code (useful for dropping directly into Claude Code / Cursor)

**Animation Library:**
- `GSAP` — most powerful, best for complex animations (default)
- `CSS` — pure CSS animations, no library needed
- `Framer` — Framer Motion, for React projects

### Step 4 — Analyze & Generate

Click **Analyze & Generate**. The loading screen shows three steps cycling:
- Parsing layout
- Extracting tokens
- Writing code

Takes 5–15 seconds depending on complexity.

### Step 5 — Read the output

Four tabs appear:

**Dev Specs**
A structured table with:
- Layout (dimensions, padding, grid)
- Colors (exact hex values)
- Typography (font, size, weight)
- Animation (type, duration, easing, trigger)

This spec is designed to be copy-pasted into Claude Code, Cursor, or handed to a developer. It's precise enough to implement without the original design file.

**HTML**
A complete, standalone HTML file. Just save it as `.html`, open in browser — it runs. Includes:
- Full `<!DOCTYPE html>` structure
- CDN script tags for whichever animation library you chose
- Inline CSS
- Inline animation JS

**CSS**
The extracted CSS-only snippet — for when you're dropping into an existing project.

**JS / GSAP** (label changes based on selected lib)
The extracted animation code only — clean, commented, ready to paste.

Each tab has a **Copy** button — click it to copy the entire contents to clipboard. Button says "Copied!" briefly to confirm.

---

## Suggestions Panel

The suggestions panel lives below the output panel on the right side.

**How to use:**
1. Type your instruction in the instruction box
2. Click **Get Suggestions**
3. Wait ~2 seconds

**What it returns (powered by Gemini):**

`🎯 Identity card` — tells you the technical name for what you're describing
> *"Aap jo describe kar rahe ho woh wireframe globe hai — CSS 3D sphere ya canvas-based"*

`💡 Specific approach` — suggests exact improved instructions to try
> *"Try karo: 'wireframe globe CSS 3D rotation, latitude longitude lines, continuous spin, 4s loop, linear easing'"*

`💬 Missing info` — flags what's not mentioned that would improve the output
> *"Trigger mention nahi — page load pe start hoga ya scroll pe?"*

**Important:** Suggestions are separate from output. They don't replace or affect the generated code. They only help you write a better instruction before you click Analyze.

If no API key is set, suggestions fall back to smart keyword-based hints (still useful, just not AI-powered).

---

## URL Fetching — How It Works

When you paste a URL and click Fetch, two things happen in parallel:

### Screenshot
Uses [thum.io](https://image.thum.io) — a free screenshot service. No API key needed.
- Captures the page at 1200px wide
- Converts to base64
- Sent to Gemini as a vision input (Gemini literally sees the page)

### Source Code Extraction
Uses [corsproxy.io](https://corsproxy.io) to fetch the page HTML from the browser.
Then extracts only animation-relevant code:
- `<style>` blocks containing: `animation`, `transition`, `transform`, `@keyframes`
- `<script>` blocks containing: `gsap`, `anime`, `motion`, `.animate`, `requestAnimationFrame`
- Caps at 20,000 characters to stay within Gemini's context limit

**Both are sent to Gemini** — screenshot for visual context, source code so Gemini can read the actual animation implementation.

**What works:**
- Public websites with direct URLs
- Sites that don't block screenshots (most do allow)
- Sites using CSS animations or GSAP (most modern sites)

**What may not work:**
- Sites behind login/paywall
- Sites that block CORS aggressively
- Heavy JavaScript-rendered SPAs (source code may not contain animation logic)
- If it fails: download a screenshot manually and upload it instead

---

## The AI Brain — Gemini 2.5 Flash

**Model:** `gemini-2.5-flash`
- Multimodal — sees images AND reads text
- Understands Hinglish natively
- 1 million token context window
- Fast (usually 5–15 seconds for this use case)

**What the prompt instructs Gemini to do:**
1. Look at the uploaded image carefully — extract colors, spacing, typography, layout
2. Understand Hinglish instruction directly
3. Identify: motion type, direction, timing, easing, trigger
4. Generate a **complete standalone HTML file** (not snippets — the full file)
5. For 3D elements (spheres, globes): use CSS 3D transforms or canvas — never flat SVG
6. Always include the CDN script tag for the chosen animation library

**The output format** Gemini returns is structured JSON:
```json
{
  "component": "wireframe-globe",
  "specs": { "groups": [...] },
  "html": "complete HTML file...",
  "css": "CSS snippet...",
  "js": "GSAP code..."
}
```

The tool parses this JSON and renders it into the tabbed output panel.

---

## Technical Decisions

### Why no server / backend?
This is a personal local tool. Running it as a plain HTML file means:
- Zero setup — just open in browser
- No hosting costs
- No deployment
- API key stays on your machine

### Why Gemini and not Claude?
The user has a Gemini API key. Gemini 2.5 Flash is available on the free tier, supports vision, and has a 1M token context window which is useful for large page sources.

When Claude API access is available, `analyzeDesign()` can be swapped — the function signature and return format stay the same.

### Why GSAP as default?
GSAP is the industry standard for complex web animations. It's more capable than CSS for anything non-trivial (timelines, sequences, ScrollTrigger, physics). The tool also supports CSS animations and Framer Motion as alternatives.

### Why localStorage for the API key?
Simplest secure-enough approach for a local personal tool. The key never leaves the browser — it goes from localStorage directly to Google's API in the fetch request. No server, no logs.

### Why CORS proxy for URL fetching?
Browsers block cross-origin requests for security. A CORS proxy (corsproxy.io) adds the necessary headers. This is fine for a personal tool — not recommended for production.

---

## Known Limitations (Current)

| Issue | Cause | Workaround |
|---|---|---|
| Globe looks flat | Gemini generated SVG ellipse | Prompt improved to force CSS 3D / canvas — retry |
| Animation doesn't run | GSAP CDN missing in output | Prompt now forces full standalone HTML — retry |
| URL fetch fails | CORS blocked or screenshot blocked | Download and upload the image manually |
| Generic output | Instruction too vague | Use Suggestions to improve your instruction first |
| Slow response | Gemini processing large images | Compress images before uploading |

---

## Roadmap — Power-ups Planned

These are features discussed but intentionally not built yet. Build only after using the MVP enough to know which ones are actually needed.

| Power-up | What it does |
|---|---|
| **Live preview** | Render the generated HTML file in an iframe right in the tool |
| **Difficulty rating** | AI rates how complex the animation is (Easy / Medium / Hard) |
| **Component memory** | Save previous outputs, reference them in future prompts |
| **Refinement chat** | After output, chat to refine — *"aur smooth karo"*, *"dark theme chahiye"* |
| **GIF recording** | Record a screen GIF and upload directly from the tool |
| **Export to Figma** | Push the specs as Figma variables/components |
| **Batch mode** | Analyze multiple screens at once |
| **Version history** | Compare outputs across multiple attempts |
| **Share link** | Generate a shareable URL for the output |
| **Framework output** | Output as React component, Vue component, etc. |

---

## Changelog

### April 2026 — Initial Build

- Built complete UI: upload zone, instruction input, options, output panel
- Dark theme with purple accent (`#7c6dfa`)
- Drag-and-drop file upload with preview grid
- Segmented controls for output format and animation library
- Loading state with cycling step pills
- Output tabs: Dev Specs, HTML, CSS, JS/GSAP
- Copy buttons on all code tabs
- Fixed viewport layout (no page scroll)
- Suggestions panel with Gemini-powered contextual tips
- Gemini 2.5 Flash connected as AI brain
- URL input with screenshot + source code extraction
- API key management (localStorage, green dot indicator)

---

## Built With

- **Vanilla HTML/CSS/JS** — no framework, no build step
- **Google Gemini 2.5 Flash** — AI vision + code generation
- **thum.io** — free website screenshot service
- **corsproxy.io** — CORS proxy for URL fetching
- **GSAP** (in generated output) — animation library

---

*Built by Khushbu — a designer who wanted to build mindblowing websites without learning to code.*
