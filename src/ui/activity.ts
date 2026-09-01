import { CHALLENGES } from "../activity/definition.js";

/**
 * The activity UI.
 *
 * Everything the mouse can do, the keyboard can do. Every change is announced.
 * The graph has a real text alternative rather than alt="chart". Colour is
 * never the only channel. These are the four things that are hard about making
 * interactive learning content accessible, so they are the four things this
 * demonstrates.
 */
export function activityHtml(launchId: string, canGrade: boolean, displayName: string | null): string {
  const challenges = JSON.stringify(
    CHALLENGES.map((c) => ({ id: c.id, prompt: c.prompt, points: c.points, mathml: c.equationMathml })),
  );
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Slope and intercept</title>
<style>
:root{--ink:#0f172a;--dim:#475569;--faint:#64748b;--line:#e2e8f0;--bg:#f8fafc;--paper:#fff;
      --blue:#2563eb;--mint:#059669;--amber:#b45309;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:1.5rem}
h1{font-size:1.3rem;margin:0 0 .25rem}
.meta{color:var(--faint);font-size:13px;font-family:var(--mono)}
.panel{background:var(--paper);border:1px solid var(--line);margin-top:1.25rem}
.panel>h2{margin:0;padding:.75rem 1.1rem;border-bottom:1px solid var(--line);
          font:700 11.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.body{padding:1.1rem}
.grid{display:grid;grid-template-columns:1fr 320px;gap:1.25rem}
@media (max-width:820px){.grid{grid-template-columns:1fr}}
svg{width:100%;height:auto;background:var(--paper);border:1px solid var(--line)}
label{display:block;font-weight:600;font-size:14px;margin-top:.9rem}
input[type=range]{width:100%}
.val{font-family:var(--mono);font-size:13px;color:var(--blue);font-weight:700}
.hint{color:var(--faint);font-size:12.5px;margin-top:.2rem}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:.5rem}
th,td{text-align:left;padding:.35rem .6rem .35rem 0;border-bottom:1px solid var(--line)}
th{font:700 11px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.on{color:var(--mint);font-weight:700}.off{color:var(--dim)}
button{border:1px solid var(--ink);background:var(--ink);color:#fff;padding:.6rem 1.1rem;
       font-size:14px;font-weight:600;cursor:pointer;margin-top:1rem}
button.ghost{background:transparent;color:var(--ink)}
button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.status{margin-top:1rem;padding:.8rem 1rem;background:#eff6ff;border-left:3px solid var(--blue);font-size:14px}
nav.chal{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:1rem}
nav.chal button{margin:0;padding:.4rem .8rem;font-size:13px;background:transparent;color:var(--ink);border:1px solid var(--line)}
nav.chal button[aria-current=true]{background:var(--blue);border-color:var(--blue);color:#fff}
.done{color:var(--mint);font-weight:700}
</style></head><body>
<div class="wrap">
  <h1>Slope and intercept</h1>
  <p class="meta">${displayName ? `Signed in as ${escapeHtml(displayName)}` : "Signed in anonymously (the platform did not share a name)"}${canGrade ? " · instructor view" : ""}</p>

  <nav class="chal" id="tabs" aria-label="Challenges"></nav>

  <div class="panel"><h2>Challenge</h2><div class="body">
    <p id="prompt"></p>
    <div id="equation" aria-label="The equation of a line in slope-intercept form"></div>

    <div class="grid">
      <div>
        <svg id="graph" viewBox="0 0 420 300" role="img" aria-labelledby="graphdesc"></svg>
        <p id="graphdesc" class="hint"></p>
      </div>
      <div>
        <label for="m">Slope (m) <span class="val" id="mv"></span></label>
        <input type="range" id="m" min="-5" max="5" step="0.1" value="1"
               aria-describedby="mhint" />
        <p class="hint" id="mhint">Arrow keys change by 0.1. Page Up and Page Down change by 1.</p>

        <label for="b">Y-intercept (b) <span class="val" id="bv"></span></label>
        <input type="range" id="b" min="-10" max="10" step="0.1" value="0"
               aria-describedby="bhint" />
        <p class="hint" id="bhint">Arrow keys change by 0.1. Page Up and Page Down change by 1.</p>

        <h3 style="font-size:13px;margin:1.2rem 0 0;font-family:var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--faint)">
          Points your line must pass through
        </h3>
        <table><caption class="sr">Target points and whether your current line passes through each</caption>
          <thead><tr><th scope="col">x</th><th scope="col">target y</th><th scope="col">your y</th><th scope="col">match</th></tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="status" id="status" role="status" aria-live="polite"></div>
    <p class="sr" id="live" role="status" aria-live="polite"></p>

    <button id="submit">Submit all answers</button>
    <button id="reset" class="ghost">Reset this challenge</button>
    <div id="result"></div>
  </div></div>
</div>
<script>
const LAUNCH_ID = ${JSON.stringify(launchId)};
const CHALLENGES = ${challenges};
const TOL = 0.05;
const state = {};
CHALLENGES.forEach(c => state[c.id] = { m: 1, b: 0 });
let current = CHALLENGES[0].id;
let announceTimer = null;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const spoken = n => (n < 0 ? "negative " + fmt(Math.abs(n)) : fmt(n));

function renderTabs() {
  $("tabs").innerHTML = CHALLENGES.map((c, i) => {
    const solved = matched(c, state[c.id]) === c.points.length;
    return '<button role="tab" aria-current="' + (c.id === current) + '" data-c="' + c.id + '">' +
      'Challenge ' + (i + 1) + (solved ? ' <span class="done" aria-label="solved">&#10003;</span>' : '') + '</button>';
  }).join("");
  document.querySelectorAll("[data-c]").forEach(b =>
    b.addEventListener("click", () => { current = b.dataset.c; render(); $("m").focus(); }));
}

function matched(c, s) { return c.points.filter(p => Math.abs(s.m * p.x + s.b - p.y) <= TOL).length; }
function challenge() { return CHALLENGES.find(c => c.id === current); }

function render() {
  const c = challenge(), s = state[c.id];
  $("prompt").textContent = c.prompt;
  $("equation").innerHTML = c.mathml;
  $("m").value = s.m; $("b").value = s.b;
  $("mv").textContent = fmt(s.m); $("bv").textContent = fmt(s.b);
  renderTabs(); renderTable(); renderGraph();
  const hit = matched(c, s);
  const msg = hit === c.points.length
    ? "Solved. Your line passes through all " + c.points.length + " points."
    : "Your line passes through " + hit + " of " + c.points.length + " points.";
  $("status").textContent = msg;
  $("graphdesc").textContent =
    "Line with slope " + fmt(s.m) + " and y-intercept " + fmt(s.b) + ". " + msg +
    " The table beside the graph lists every point and whether it matches.";
}

function renderTable() {
  const c = challenge(), s = state[c.id];
  $("tbody").innerHTML = c.points.map(p => {
    const y = s.m * p.x + s.b;
    const ok = Math.abs(y - p.y) <= TOL;
    // Colour is never the only channel: the word and the tick both carry it.
    return "<tr><td>" + p.x + "</td><td>" + p.y + "</td><td>" + fmt(y) + "</td>" +
      '<td class="' + (ok ? "on" : "off") + '">' + (ok ? "&#10003; yes" : "&#215; no") + "</td></tr>";
  }).join("");
}

function renderGraph() {
  const c = challenge(), s = state[c.id];
  const W = 420, H = 300, cx = W / 2, cy = H / 2, u = 26;
  const px = x => cx + x * u, py = y => cy - y * u;
  let g = '<rect width="' + W + '" height="' + H + '" fill="#fff"/>';
  for (let i = -8; i <= 8; i++) {
    g += '<line x1="' + px(i) + '" y1="0" x2="' + px(i) + '" y2="' + H + '" stroke="#eef2f7"/>';
    g += '<line x1="0" y1="' + py(i) + '" x2="' + W + '" y2="' + py(i) + '" stroke="#eef2f7"/>';
  }
  g += '<line x1="0" y1="' + cy + '" x2="' + W + '" y2="' + cy + '" stroke="#94a3b8"/>';
  g += '<line x1="' + cx + '" y1="0" x2="' + cx + '" y2="' + H + '" stroke="#94a3b8"/>';
  const x1 = -8, x2 = 8;
  g += '<line x1="' + px(x1) + '" y1="' + py(s.m * x1 + s.b) + '" x2="' + px(x2) + '" y2="' +
       py(s.m * x2 + s.b) + '" stroke="#2563eb" stroke-width="2.5"/>';
  c.points.forEach(p => {
    const ok = Math.abs(s.m * p.x + s.b - p.y) <= TOL;
    // Matched points are a filled circle, unmatched an open square: shape as
    // well as colour, so the distinction survives without colour vision.
    g += ok
      ? '<circle cx="' + px(p.x) + '" cy="' + py(p.y) + '" r="6" fill="#059669"/>'
      : '<rect x="' + (px(p.x) - 5) + '" y="' + (py(p.y) - 5) + '" width="10" height="10" fill="none" stroke="#b45309" stroke-width="2"/>';
  });
  $("graph").innerHTML = g;
}

function announce() {
  // Throttled: dragging a slider must not produce a hundred announcements.
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const c = challenge(), s = state[c.id];
    $("live").textContent = "Slope " + spoken(s.m) + ", y-intercept " + spoken(s.b) +
      ". Passes through " + matched(c, s) + " of " + c.points.length + " points.";
  }, 220);
}

function bind(id, key) {
  const el = $(id);
  el.addEventListener("input", () => { state[current][key] = Number(el.value); render(); announce(); });
  // A documented large step. Moving -10..10 in 0.1 increments one press at a
  // time is not a usable keyboard interaction.
  el.addEventListener("keydown", e => {
    if (e.key !== "PageUp" && e.key !== "PageDown") return;
    e.preventDefault();
    const delta = e.key === "PageUp" ? 1 : -1;
    const min = Number(el.min), max = Number(el.max);
    state[current][key] = Math.min(max, Math.max(min, state[current][key] + delta));
    render(); announce();
  });
}
bind("m", "m"); bind("b", "b");

$("reset").addEventListener("click", () => { state[current] = { m: 1, b: 0 }; render(); announce(); $("m").focus(); });

$("submit").addEventListener("click", async () => {
  const btn = $("submit"); btn.disabled = true; btn.textContent = "Submitting…";
  try {
    const answers = CHALLENGES.map(c => ({ challengeId: c.id, m: state[c.id].m, b: state[c.id].b }));
    const res = await fetch("/attempt", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ launchId: LAUNCH_ID, answers }),
    });
    const out = await res.json();
    $("result").innerHTML = '<div class="status" role="status">' +
      "<strong>Score " + out.score + " of " + out.maxScore + ".</strong> " +
      esc(out.passback ? out.passback.message : "No gradebook is connected to this launch, so the score was recorded here only.") +
      "</div>";
  } catch (err) {
    $("result").innerHTML = '<div class="status" role="alert">Could not submit: ' + esc(err.message) + "</div>";
  } finally { btn.disabled = false; btn.textContent = "Submit all answers"; }
});

render();
</script></body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
