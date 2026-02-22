# Project Lazarus Brand Guidelines

**"The Legacy Code Necromancer"**

This document defines the visual identity for **Project Lazarus**. The aesthetic is "Void Black + Rail Purple"—utilizing a deep void-black palette with rail purple and electric cyan accents to create a "Glass Brain" aesthetic that conveys autonomous intelligence, transmutation, and modern software engineering.

---

## Primary UI Palette (Enterprise Rule)

**Use only a couple of colors so the website looks professional and enterprise-grade.**

| Role | Color | Usage |
| :--- | :--- | :--- |
| **Background** | **Void Black** (`#0A0A0F`) | **Always.** All page and section backgrounds use Void Black. |
| **Fonts & components** | **Rail Purple** (`#6E18B3`) **or** **Electric Cyan** (`#00E5FF`) | All accents: buttons, borders, icons, links, highlights, and non-text UI. Use Cloud White for body text. |

- **Do not** introduce extra accent colors (e.g. avoid standalone Quantum Violet, Slate Grey, or other hues for UI).
- **Text:** Primary reading text = Cloud White (`#FAFAFA`). Muted text = `rgba(250, 250, 250, 0.6)`.
- **Focus / ring:** Electric Cyan for consistency and accessibility.

This limited palette is implemented in `styles/tailwind.css` and across all landing and UI components.

---

## 1. Brand Core

| Element | Definition |
| :--- | :--- |
| **Name** | Project Lazarus |
| **Tagline** | The Legacy Code Necromancer |
| **Concept** | Autonomous AI platform that transmutes legacy software into modern web applications |
| **Vibe** | Void Black, Glass Brain, Rail Purple, Electric Cyan, Transmutation |

---

## 2. Brand Voice: The "Civilized Alchemist"

We use the language of **transmutation**, with the tone of a **structural engineer**—so we don't scare off the bank manager.

| Don't say | Do say |
| :--- | :--- |
| "We use magic to fix your code." | "We transmute legacy debt into modern assets using deterministic verification." |
| "The AI guesses the fix." | "The agent diagnoses the root cause and synthesizes a correction." |

**Keywords:** *Transmute, Synthesize, Verify, Ground Truth, Deterministic, Reincarnate.*

---

## 3. Color Philosophy

### The "Glass Brain" Aesthetic

Our color system creates a deep, immersive environment where **void black backgrounds** provide high contrast for **rail purple** and **electric cyan** elements. The "Glass Brain" concept visualizes the AI's cognition (Plan, Work, Thoughts) through translucent panels and glowing accents.

**Why this works for Project Lazarus:**
- **Void Black (#0A0A0F)**: Represents the "void" from which legacy code is brought back to life.
- **Rail Purple (#6E18B3)**: Represents the "rail" or guided path of transmutation.
- **Electric Cyan (#00E5FF)**: Represents the spark of intelligence and modern technology.

#### The "Bicameral" Color Logic

To communicate the **Two Brains** architecture instantly, we separate color usage by function—every color has a *cognitive, engineering purpose*:

| Color | Represents | Use for |
| :--- | :--- | :--- |
| **Electric Cyan (`#00E5FF`)** | **New Intelligence** — Code Synapse, Generation, Forward Momentum | Primary buttons, active cursors, generated code, "Ship Ready" confidence |
| **Rail Purple (`#6E18B3`)** | **Deep Context** — Necroma, Legacy Analysis, Structure | Background borders, knowledge-graph nodes, "Self-Healing" diagnosis, historical logs |

**Rule:** *Cyan is the Spark. Purple is the Wire.*

For the full **Glass Brain View** design and UX patterns (boot sequence, breathing glow, event colors, animations), see **Section 10**.

---

## 4. Color Palette Quick Reference

### Background Colors

| Color | Hex | RGB | Role |
| :---: | :--- | :--- | :--- |
| ![#0A0A0F](https://via.placeholder.com/16/0A0A0F/0A0A0F?text=+) | `#0A0A0F` | (10, 10, 15) | **Void Black** (Main Background) |
| ![#1E1E28](https://via.placeholder.com/16/1E1E28/1E1E28?text=+) | `#1E1E28` | (30, 30, 40) | **Slate Grey** (Secondary/Muted) |
| ![#050507](https://via.placeholder.com/16/050507/050507?text=+) | `#050507` | (5, 5, 7) | **Obsidian** (Darker Depth) |

### Foreground Colors

| Color | Hex | RGB | Role |
| :---: | :--- | :--- | :--- |
| ![#6E18B3](https://via.placeholder.com/16/6E18B3/6E18B3?text=+) | `#6E18B3` | (110, 24, 179) | **Rail Purple** (Primary Brand) |
| ![#8134CE](https://via.placeholder.com/16/8134CE/8134CE?text=+) | `#8134CE` | (129, 52, 206) | **Quantum Violet** (Lighter Purple) |
| ![#00E5FF](https://via.placeholder.com/16/00E5FF/00E5FF?text=+) | `#00E5FF` | (0, 229, 255) | **Electric Cyan** (Accent/Intelligence) |
| ![#FAFAFA](https://via.placeholder.com/16/FAFAFA/FAFAFA?text=+) | `#FAFAFA` | (250, 250, 250) | **Cloud White** (Primary Text) |

---

## 5. Background Palette (Void Black & Glass)

These are the structural colors—the canvas on which Project Lazarus operates.

| Token | Hex | Role |
| :--- | :--- | :--- |
| **Background** | `#0A0A0F` | Main canvas, page background |
| **Card** | `rgba(30, 30, 40, 0.4)` | Glass panels (Glass Brain panes) |
| **Muted** | `rgba(30, 30, 40, 0.5)` | Secondary backgrounds, inputs |
| **Border** | `rgba(250, 250, 250, 0.1)` | Borders, dividers (subtle) |

### Usage Guidelines

```css
/* Page background */
background: #0A0A0F;

/* Glass Card */
background: rgba(30, 30, 40, 0.4);
backdrop-filter: blur(12px);
border: 1px solid rgba(250, 250, 250, 0.1);
```

### ⚠️ Accessibility & Usage Rules (Strict)

*   **Rail Purple (#6E18B3)**: Use **ONLY** for graphics, backgrounds, borders, icons, and gradients. **NEVER** use for body text or small labels (Contrast 3.5:1 fails WCAG AA).
*   **Electric Cyan (#00E5FF)**: Safe for text and icons (Contrast 13:1). Use for active states, links, and "intelligence" accents.
*   **Cloud White (#FAFAFA)**: Use for all primary reading text.
*   **Quantum Violet (#8134CE)**: Use only inside the Rail Fade gradient, not as a standalone UI color.

---

## 6. Foreground Palette (Rail & Spark)

The gradients represent the flow of data and the transformation process.

| Token | Hex | Role |
| :--- | :--- | :--- |
| **Rail Purple** | `#6E18B3` | Primary actions, brand identity |
| **Electric Cyan** | `#00E5FF` | Active states, code execution, "intelligence" |
| **Success** | `#00FF88` | Successful transmutation/test (semantic only) |
| **Warning** | `#FFB800` | Issues requiring attention (semantic only) |
| **Error** | `#FF3366` | Critical failures (semantic only) |

### Gradient Definition

```css
/* Rail Fade (Primary Brand Gradient) */
background: linear-gradient(135deg, #8134CE 0%, #6E18B3 100%);

/* Automation Flow (Hero/CTA) */
background: linear-gradient(90deg, #00E5FF 0%, #8134CE 50%, #6E18B3 100%);
```

---

## 6.1 Confidence Glows (Framing)

Use these glows for clear, beautiful framing across the landing page (e.g. confidence tiers, status indicators, or progress states).

| Range   | Hex     | Effect                          | Tailwind / Usage                                      |
| :---    | :---    | :---                            | :---                                                  |
| **40–70%**  | `#FFB800` | Subtle yellow glow              | `glow-yellow`                                         |
| **70–85%**  | `#00E5FF` | Cyan glow                       | `glow-cyan`                                           |
| **≥ 85%**   | `#00FF88` | Green glow + pulse              | `glow-success-pulse` (green glow + `animate-pulse-glow`) |

### Usage

- **40–70%:** Caution or in-progress state; soft yellow keeps the frame visible without dominating.
- **70–85%:** Strong confidence; Electric Cyan aligns with brand “intelligence” and stays on-palette.
- **≥ 85%:** High confidence / success; green glow with `animate-pulse-glow` for a clear, positive signal.

Implement in `styles/tailwind.css` via `.glow-yellow`, `.glow-cyan`, and `.glow-success-pulse`.

---

## 7. Typography System — Enterprise Guide

**"The Industrial Terminal Aesthetic"**

Our typography is the voice of the machine. It must be precise, engineered, and readable. We avoid decorative fonts in favor of functional, high-performance typefaces that feel native to a developer's environment (IDEs, terminals, documentation). The system conveys **Technical Rigor**, **Safety**, and **Intelligence**.

### 7.1 Typeface Selection

We use a three-font stack: **Brand Voice** (headlines), **Utility** (UI/body), and **Data** (code).

| Role | Font Family | Weight | Why we use it |
| :--- | :--- | :--- | :--- |
| **HEADLINES** | **Space Grotesk** | Bold (700), SemiBold (600) | Geometric sans that feels "engineered" and "manufactured." Anchors the "Industrial" vibe. |
| **INTERFACE** | **Inter** | Regular (400), Medium (500) | Enterprise standard for legibility. Invisible, frictionless, and safe. |
| **DATA & CODE** | **JetBrains Mono** | Regular (400) | Gold standard for code. Signals immediately: "This is a developer tool." |

Sources: [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk), [Inter](https://fonts.google.com/specimen/Inter), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono).

### 7.2 Type Hierarchy & Scaling

A distinct scale ensures hero messages feel massive and confident, while documentation stays dense and scannable.

#### Display Levels (Space Grotesk)

*Hero sections, huge statements, landing impact.*

| Token | Size (Mobile / Desktop) | Weight | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Display XL** | `48px` / `72px` | Bold (700) | `-0.04em` | Main landing hero ("Vibe Coding, Industrialized") |
| **Display L** | `36px` / `56px` | Bold (700) | `-0.03em` | Major section headers ("The Day 2 Hangover") |
| **Display M** | `30px` / `48px` | SemiBold (600) | `-0.02em` | Feature block headers |

#### Heading Levels (Space Grotesk)

*Cards, articles, product interfaces.*

| Token | Size | Weight | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **H1** | `32px` | SemiBold (600) | `-0.02em` | Page titles (dashboard/docs) |
| **H2** | `24px` | SemiBold (600) | `-0.01em` | Section dividers, large cards |
| **H3** | `20px` | Medium (500) | `0` | Card titles, modal headers |
| **H4** | `16px` | Medium (500) | `0` | Small labels, sub-sections |

#### Body & UI (Inter)

*All reading text, buttons, inputs.*

| Token | Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Body Large** | `18px` | Regular (400) | `1.6` | Hero subtext, intros |
| **Body Base** | `16px` | Regular (400) | `1.6` | Standard blog/docs text |
| **Body Small** | `14px` | Regular (400) | `1.5` | Dashboard UI, cards, inputs |
| **Caption** | `12px` | Medium (500) | `1.4` | Metadata, timestamps, footnotes |

#### Code & Technical (JetBrains Mono)

*Terminal streams, code blocks, logs, technical badges.*

| Token | Size | Color | Usage |
| :--- | :--- | :--- | :--- |
| **Code Base** | `14px` | Cloud White | Code snippets, main terminal output |
| **Code Small** | `12px` | Muted / Electric Cyan | Inline code (`npm install`), badges |
| **Code Tiny** | `10px` | Muted | Line numbers, subtle logs |

### 7.3 Styling & Effects

#### The "Industrial" Gradient Text

Use only for high-impact keywords (e.g. "Industrialized", "Ground Truth"). Do not overuse.

```css
/* Tailwind: text-gradient */
background: linear-gradient(135deg, #8134CE 0%, #6E18B3 100%);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
background-clip: text;
```

#### The "Terminal" Glow

For code blocks or Electric Cyan text to suggest an active terminal / CRT.

```css
/* Tailwind: text-glow-cyan */
color: #00E5FF;
text-shadow: 0 0 10px rgba(0, 229, 255, 0.5);
```

See `styles/tailwind.css` for `.text-glow-cyan` and `.text-glow-purple`.

#### Selection State

Keep selection on-brand and immersive.

```css
::selection {
  background: rgba(0, 229, 255, 0.3);
  color: #FAFAFA;
}
```

### 7.4 Tailwind Implementation

Display and glow utilities are defined in `styles/tailwind.css`:

- **Display:** `.text-display-xl` (48px → 72px at `md`), `.text-display-lg` (36px → 56px at `md`), `.text-display-m` (30px → 48px at `md`).
- **Glow:** `.text-glow-cyan`, `.text-glow-purple`.

Use `font-grotesk`, `font-sans`, and `font-mono` for the three roles. Theme variables: `--font-grotesk`, `--font-sans`, `--font-mono`.

### 7.5 Usage Rules (Do's & Don'ts)

| Do | Don't |
| :--- | :--- |
| Use **Space Grotesk** in ALL CAPS with wide tracking (`tracking-widest`) for small labels like "ENTERPRISE" or "BETA". | Use **Space Grotesk** for paragraphs — it becomes hard to read at small sizes. |
| Use **JetBrains Mono** for specific technical terms inside body text (e.g. "The `agent_events` table…"). | Use **JetBrains Mono** for long paragraphs — it creates eye strain. |
| Use **Cloud White (`#FAFAFA`)** for headlines and body on Void Black. | Use pure white (`#FFFFFF`) for large headlines — it can "vibrate" against the black background. |
| Use **muted** (`rgba(250,250,250,0.6)`) strictly for metadata, captions, footnotes. | Use accent colors for long-form body text. |

### 7.6 The "Flight Deck" Rule (Data Density)

Enterprise tools are defined by **information density**. Labels and numbers must be scannable and stable.

| Element | Rule | Example |
| :--- | :--- | :--- |
| **Labels** | Uppercase, `text-[10px]`, `tracking-widest`, `font-grotesk`, `text-muted-foreground`. Use `.text-label`. | `CONFIDENCE SCORE`, `LATENCY` |
| **Numbers** | Always `font-mono` (JetBrains), `tabular-nums` so numbers don't jitter when changing. | Counters, metrics, timers |
| **Logs** | `text-xs`, `leading-tight`, `opacity-80`. | Terminal output, event streams |
| **Glow** | Apply only to *changing* data (the delta), never to static data. | Live confidence %, active cursor |

---

## 8. Logo & Brand Assets

### 8.1 Logo System

The AutoRail logo system has three tiers — **Icon**, **Wordmark**, and **Icon + Wordmark** — each designed for different contexts. All assets live in `public/` and `app/`.

| File | Format | Contains | Usage |
| :--- | :--- | :--- | :--- |
| `app/icon.svg` | SVG | Icon only | Favicon, browser tab, PWA icon |
| `public/autorail.svg` | SVG | Icon only | Standalone brand mark (e.g. loading states, small spaces) |
| `public/autorail-wordmark.svg` | SVG | Wordmark only | Text-only logo — "autorail" in JetBrains Mono, Rail Purple (`#6E18B3`), with purple glow drop shadow. Use where the icon is not needed or space is constrained. |
| `public/icon-wordmark.svg` | SVG | Icon + Wordmark | **Primary lockup.** Icon and "autorail" wordmark side-by-side with matching purple glow. Use for NavBar, Footer, and any context where the full brand identity is needed. |

### 8.2 Logo Specifications

- **Icon:** Geometric turbine/flower symbol rendered with a Rail Purple gradient (`#8333D2` → `#5C0B96`) and purple glow drop shadow.
- **Wordmark:** "autorail" typeset in **JetBrains Mono Bold**, filled Rail Purple (`#6E18B3`), with a matching purple glow drop shadow (`stdDeviation: 8`, `opacity: 0.5`).
- **Naming:** Always use lowercase **autorail** in the wordmark. Never "AutoRail.dev" — the `.dev` is for the URL, not the brand. See §8.4.

### 8.3 Using Logos in Code

```tsx
import Image from "next/image"

// Icon + Wordmark (NavBar, Footer — primary usage)
<Image src="/icon-wordmark.svg" alt="autorail" width={233} height={77} className="h-10 w-auto" />

// Wordmark only (inline references, compact layouts)
<Image src="/autorail-wordmark.svg" alt="autorail" width={178} height={58} className="h-8 w-auto" />

// Icon only (favicon, small spaces)
<Image src="/autorail.svg" alt="autorail" width={32} height={32} />
```

### 8.4 Naming Convention

| Context | Format | Example |
| :--- | :--- | :--- |
| **Logo / Wordmark** | Lowercase `autorail` | `> autorail` |
| **Legal / Copyright** | Title case with "Inc." | `© 2026 autorail Inc.` |
| **URL** | `autorail.dev` | `https://autorail.dev` |
| **GitHub org** | PascalCase | `AutoRail-AI` |

**Rule:** The brand name is **autorail** — lowercase, monospace, no `.dev` suffix. The URL is the address; the name is the infrastructure.

### 8.5 Clear Space & Minimum Size

- **Clear space:** Maintain at least 1× the icon height of padding around the full lockup.
- **Minimum size:** Icon-wordmark lockup should not be rendered smaller than `h-8` (32px height). Icon-only should not be smaller than 16×16px.
- **Background:** Always place on Void Black (`#0A0A0F`) or sufficiently dark backgrounds. The purple glow effect requires dark contrast to read correctly.

---

## 9. UI Principles

1. **Void Black Canvas:** Always start with `#0A0A0F`.
2. **Limited Accents:** Use only Rail Purple and Electric Cyan for fonts (accents), buttons, borders, icons, and glows—with **Bicameral** logic: Cyan = New Intelligence / Spark; Purple = Deep Context / Wire.
3. **Industrial Glass (HUD Style):** Avoid soft, pillow-like glass. Our glass is structural.
   - **Borders:** All glass panels must have a `1px` border. Use `border-white/10` for passive, `border-electric-cyan/30` for active.
   - **Corners:** Use tighter radii (`rounded-lg` or `rounded-xl`). Never `rounded-3xl` (pill shapes are for consumers, not engineers).
   - **Texture:** Use a subtle grid overlay on the deepest backgrounds (e.g. `bg-grid-pattern`) for a sense of "spatial mapping."
4. **Motion Physics: Machine Precision:** Animations should feel like high-end machinery, not organic fluid.
   - **The Snap:** Use `ease-out` (fast → slow) for entrances. It shows responsiveness.
   - **The Pulse:** Status lights (e.g. Project Pulse) should use a "heartbeat" rhythm (double beat) rather than a sine wave—more biological/alive.
   - **The Glitch:** Use `animate-glitch` *only* for "Transformation Events" (Legacy → Modern) or "Self-Healing" triggers. It visualizes the Necromancy—breaking the old reality to form the new.
5. **Information Density:** High density (dashboard style), `text-sm` base size. CTOs want data; see **§7.6 The Flight Deck Rule**.
6. **Glow Effects:** Use `glow-purple` or `glow-cyan` for active states/focus. For confidence/framing tiers use the **Confidence Glows** (§6.1): `glow-yellow` (40–70%), `glow-cyan` (70–85%), `glow-success-pulse` (≥ 85%).

---

## 10. Glass Brain View — Design & UX

*Reference: `docs/GLASS_BRAIN_VIEW.md`*

The Glass Brain is our production-grade, immersive dashboard aesthetic: Void Black + Rail Purple + Electric Cyan, with translucent panels and confidence-reactive glows. Use these patterns for any agent-facing or build-monitoring UI to keep the experience consistent and spectacular.

### 10.1 Theatrical Entry (Boot & First Impression)

**Boot sequence** establishes the “brain coming online” feel. A short, staged intro (e.g. 3–4 seconds) builds anticipation:

| Phase | Visual |
| :--- | :--- |
| 0 | Pulsing cyan dot (opacity oscillates) |
| 1 | Dot grows + radial lines (e.g. 6 lines, 60° apart) |
| 2 | “Neural Link Established” (Electric Cyan, letter-spacing) |
| 3 | “Materializing panes…” (muted, smaller) |
| 4 | Overlay fades out; main content appears |

Respect `prefers-reduced-motion`: skip to final state immediately.

### 10.2 Breathing Glow (Confidence-Reactive Framing)

Wrap key content in an **ambient glow** that reacts to state (e.g. confidence 0–1):

- **Inset box-shadow** intensity scales with value (e.g. blur 20px→60px, alpha 5%→15%).
- **Animation:** 3-keyframe loop (half → full → half), ~4s ease-in-out infinite.
- Use **Electric Cyan** for the glow color to stay on-palette.

This creates a living, reactive frame that makes the UI feel alive without distraction.

### 10.3 Layout & Panes

- **Grid:** Three-column layout, e.g. `grid-cols-[1fr_2fr_1fr]`, with `gap-3` and `p-3`.
- **Panes:** Use `glass-panel` or `glass-card` for each column; stagger entrance (e.g. 0.15s delay per column) for a materializing effect.
- **Density:** High information density, `text-sm` base; keep the “terminal/dashboard” feel.

### 10.4 Event Type Colors (Logs & Badges)

Use consistent colors for event types in logs, badges, and status indicators:

| Event / State   | Color        | Hex       | Use |
| :---            | :---         | :---      | :--- |
| thought         | Grey         | `#888888` | AI reasoning |
| tool_call       | Electric Cyan| `#00E5FF` | MCP / tools |
| code_write      | Cloud White  | `#FAFAFA` | Code changes |
| test_run        | Warning      | `#FFB800` | Tests running |
| test_result pass| Success      | `#00FF88` | Pass |
| test_result fail| Error        | `#FF3366` | Fail |
| self_heal       | Quantum Violet | `#8134CE` | Self-healing |
| confidence_update | Electric Cyan | `#00E5FF` | Confidence |
| app_start       | Mint / Success | `#30D158` / `#00FF88` | Start |

### 10.5 Animation Catalog

**CSS keyframes** (in `styles/tailwind.css`):

| Name | Purpose |
| :--- | :--- |
| `pulse-glow` | Opacity 0.5 ↔ 1; use for status dots and success glow |
| `breathing-glow` | Inset cyan glow pulse |
| `particle-flow` | Horizontal drift + fade (particles, progress) |
| `shimmer` | Background position shift (loading) |
| `float` | Gentle vertical drift |
| `fade-in` / `slide-up` | Entry transitions |

**Framer Motion patterns:**

| Pattern | Use | Config |
| :--- | :--- | :--- |
| Pane stagger | Dashboard columns | `delay: i * 0.15`, `y: 20→0`, ~0.4s ease-out |
| Status pulse | Live indicator dot | `scale: [1, 1.3, 1]`, `opacity: [0.7, 1, 0.7]`, ~1.5s repeat |
| Expanding ring | Around status dot | `scale: [1, 2.5]`, `opacity: [0.4, 0]`, ~1.5s repeat |
| Card scale-in | Overlays, cards | `scale: 0.8→1`, spring, optional stagger |
| Fade + scale | View/page transitions | `opacity: 0→1`, `scale: 0.98→1` |

**Counters:** Use rAF (requestAnimationFrame) with cubic ease-out for number changes (e.g. LOC, tests, timer). Avoid CSS transitions on width/transform for numbers.

### 10.6 Key Design Decisions

1. **No heavy charting library** — Sparklines as hand-rolled SVG; keeps bundle small.
2. **No syntax-highlighting library** — Regex-based tokenization for code display is sufficient for our use case.
3. **All numeric counters use rAF** — Smooth 60fps number animation; respect `prefers-reduced-motion` (snap to value).
4. **Glass via utility classes** — `.glass-panel` and `.glass-card` everywhere; no inline backdrop-filter.
5. **Event-driven UI** — Every visual change traces back to data/events; no purely decorative state.
6. **Sound optional** — If used, map 1:1 to event types and make togglable.
7. **Reduced motion everywhere** — Every animation has a `prefers-reduced-motion` escape hatch.

### 10.7 Self-Heal / Status Semantics

For self-heal or multi-step status flows, use a clear three-step story with consistent colors:

| Step              | Background tint      | Border / glow      | Icon   |
| :---              | :---                 | :---               | :---   |
| Failure Detected  | `rgba(255,51,102,0.08)` | Error red          | XCircle |
| Root Cause / Analysis | `rgba(110,24,179,0.08)` | Rail Purple        | Brain  |
| Fix Applied       | `rgba(0,255,136,0.08)`  | Success green      | CheckCircle |

Stagger card entrance (e.g. 0.8s between cards); use flowing particles or a simple connector between steps.

### 10.8 Scrollbar & Polish

Use a thin, minimal scrollbar so content stays primary:

```css
.custom-scrollbar::-webkit-scrollbar        { width: 6px; height: 6px; }
.custom-scrollbar::-webkit-scrollbar-track  { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb  { background: rgba(255,255,255,0.1); border-radius: 3px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
```

---

## 11. Color Combinations

| Background | Foreground | Use Case |
| :--- | :--- | :--- |
| `#0A0A0F` | `#FAFAFA` | Default page content |
| `#0A0A0F` | `#6E18B3` | Primary brand elements |
| `#0A0A0F` | `#00E5FF` | Active/Intelligence accents |
| `rgba(30, 30, 40, 0.4)` | `#FAFAFA` | Card content |

---

## 12. Data Visualization Palette

Use only Rail Purple and Electric Cyan for charts where possible.

| Series | Color | Hex | Purpose |
| :--- | :--- | :--- | :--- |
| **Series A** | Rail Purple | `#6E18B3` | Primary metric |
| **Series B** | Electric Cyan | `#00E5FF` | Secondary metric |
| **Success** | Green | `#00FF88` | Success/Pass rate (semantic) |
| **Error** | Red | `#FF3366` | Failure/Error rate (semantic) |

---

## 13. Favicons & PWA Icons

| File | Purpose |
| :--- | :--- |
| `app/favicon.ico` | Browser tab icon |
| `app/icon.svg` | Modern vector icon |
| `app/apple-icon.png` | iOS touch icon |
| `public/web-app-manifest-*.png` | PWA icons |

---

## 14. Enterprise Standards & Accessibility

**Target:** WCAG 2.1 Level AA compliance. Enterprise-grade, production-ready UI.

### Contrast Ratios (WCAG AA)

| Foreground | Background | Ratio | Pass |
| :--- | :--- | :--- | :--- |
| Cloud White (#FAFAFA) | Void Black (#0A0A0F) | ~16:1 | AAA |
| Electric Cyan (#00E5FF) | Void Black (#0A0A0F) | ~13:1 | AAA |
| Quantum Violet (#8134CE) | Void Black (#0A0A0F) | ~5:1 | AA |
| Rail Purple (#6E18B3) | Void Black (#0A0A0F) | ~3.5:1 | **FAIL** (text) |

**Rule:** Rail Purple is for graphics/icons/borders only. Never for body text or small labels.

### Focus States

All interactive elements must have visible focus indicators. Use **Electric Cyan** for focus ring:

```css
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-void-black
```

Never remove focus outline without providing an alternative.

### Reduced Motion

Support `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

The design system already includes this in `styles/tailwind.css`.

### Text Selection

Maintain brand immersion with styled selection:

```css
::selection {
  background: rgba(0, 229, 255, 0.3);
  color: #FAFAFA;
}
```

### Keyboard Navigation

- All interactive elements must be reachable via Tab
- Focus order must follow visual order
- Modals/dropdowns must trap focus and support Escape to close

### Semantic HTML & ARIA

- Use `<label>` for all form inputs (or `aria-label` when visible label is not appropriate)
- Use `aria-describedby` for helper text
- Use `aria-live` for dynamic content (e.g., confidence updates)
- Icon-only buttons must have `aria-label`

---

*Project Lazarus Brand Guidelines — The Legacy Code Necromancer*
