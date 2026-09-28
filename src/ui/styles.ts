/**
 * One stylesheet for every page this package serves.
 *
 * Written out rather than reached for, because these pages have to render on a
 * phone in a school corridor with no network left to fetch anything. Every
 * state a reader can put them in is covered: dark, light, narrow, keyboard
 * only, reduced motion, forced colours, printed, and text scaled up. A gap in
 * any of those is not a cosmetic matter — it is a parent or a pupil who cannot
 * read the answer.
 *
 * Shared rather than copied. Two stylesheets drift, and the second one drifts
 * in whichever state nobody looked at.
 */
export const STYLES = String.raw`
:root {
  color-scheme: light dark;
  --bg: #fbfbfa;
  --surface: #ffffff;
  --ink: #16161a;
  --muted: #5b5b66;
  --line: #e3e3e0;
  --pass: #1b6b3a;
  --pass-bg: #e8f4ec;
  --fail: #9b1c1c;
  --fail-bg: #fdeaea;
  --open: #6b5310;
  --open-bg: #fdf4e0;
  --focus: #2b5fd9;
  --radius: 10px;
  --step: clamp(0.9rem, 0.86rem + 0.2vw, 1rem);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131315;
    --surface: #1c1c20;
    --ink: #f2f2f0;
    --muted: #a8a8b3;
    --line: #2f2f36;
    --pass: #6fd598;
    --pass-bg: #16301f;
    --fail: #ff9d9d;
    --fail-bg: #35191a;
    --open: #f0cf7a;
    --open-bg: #332a12;
    --focus: #8fb0ff;
  }
}

*, *::before, *::after { box-sizing: border-box; }

/*
 * Any display rule out-specifies the browser's own [hidden] { display: none },
 * so an element marked hidden goes on showing. It did: the class row rendered
 * with an empty value on a page that had not loaded any yet. Stated once here
 * rather than remembered at each display rule.
 */
[hidden] { display: none !important; }

html { -webkit-text-size-adjust: 100%; }

body {
  background: var(--bg);
  color: var(--ink);
  font: var(--step)/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  margin: 0;
  padding: clamp(1rem, 4vw, 2.5rem) clamp(1rem, 4vw, 2rem) 4rem;
}

main { margin-inline: auto; max-width: 46rem; }

h1 { font-size: clamp(1.3rem, 1.1rem + 1vw, 1.7rem); letter-spacing: -0.01em; margin: 0 0 0.35rem; }
h2 { font-size: 1.02rem; letter-spacing: -0.005em; margin: 0; }

.intro { color: var(--muted); margin: 0 0 1.75rem; max-width: 40rem; }

.scope {
  align-items: baseline;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
  margin-bottom: 1.5rem;
  padding-bottom: 0.9rem;
}
.scope dt { color: var(--muted); font-size: 0.85em; margin: 0; }
.scope dd { font-weight: 600; margin: 0; overflow-wrap: anywhere; }

.draw {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  margin-bottom: 1.1rem;
  padding: clamp(0.9rem, 3vw, 1.25rem);
}

.draw__head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.8rem;
  justify-content: space-between;
  margin-bottom: 0.9rem;
}

.verdict {
  border-radius: 999px;
  font-size: 0.82em;
  font-weight: 650;
  padding: 0.28em 0.75em;
  white-space: nowrap;
}
.verdict[data-state="true"]  { background: var(--pass-bg); color: var(--pass); }
.verdict[data-state="false"] { background: var(--fail-bg); color: var(--fail); }
.verdict[data-state="null"]  { background: var(--open-bg); color: var(--open); }

.steps { display: grid; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }

.step {
  align-items: start;
  display: grid;
  gap: 0.15rem 0.6rem;
  grid-template-columns: 1.4rem 1fr;
}
.step__mark { font-variant-numeric: tabular-nums; line-height: 1.5; text-align: center; }
.step[data-ok="true"]  .step__mark { color: var(--pass); }
.step[data-ok="false"] .step__mark { color: var(--fail); }
.step[data-ok="null"]  .step__mark { color: var(--open); }
.step__name { font-weight: 550; }
.step__detail {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82em;
  grid-column: 2;
  overflow-wrap: anywhere;
}

.note {
  background: var(--open-bg);
  border-radius: 8px;
  color: var(--open);
  font-size: 0.88em;
  margin-top: 0.9rem;
  padding: 0.6rem 0.75rem;
}

.local {
  color: var(--muted);
  display: inline-flex;
  font-size: 0.8em;
  gap: 0.35em;
  margin-top: 0.85rem;
}

.empty, .problem { color: var(--muted); padding: 1.5rem 0; }

button {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  min-height: 2.75rem;
  padding: 0.5rem 1rem;
}
button:hover { border-color: var(--muted); }

:where(a, button):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* The only motion on the page, and it stops on request. */
.spinner {
  animation: spin 1s linear infinite;
  border: 2px solid var(--line);
  border-radius: 50%;
  border-top-color: var(--muted);
  display: inline-block;
  height: 1em;
  vertical-align: -0.15em;
  width: 1em;
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
  .spinner { animation: none; border-top-color: var(--line); }
}

@media (forced-colors: active) {
  .draw, button { border: 1px solid CanvasText; }
  .verdict { border: 1px solid CanvasText; }
}

@media print {
  body { background: #fff; color: #000; padding: 0; }
  .draw { break-inside: avoid; border-color: #999; }
  button { display: none; }
}

.visually-hidden {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}
`
