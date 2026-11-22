// Living Painting — deterministic generative renderer.
// Every word guests send becomes a cluster of glowing brush strokes that follow
// a flow field unique to tonight. Same words → same painting, so the screen can
// be reloaded at any time and rebuild exactly the same artwork.

export const W = 1920;
export const H = 1080;

export const MOODS = {
  joy:   { emoji: "✨", colors: ["#ffd27a", "#ffb36b", "#fff0c2"] },
  love:  { emoji: "💗", colors: ["#ff6f8e", "#ff9db0", "#ffc6d3"] },
  dream: { emoji: "🌙", colors: ["#a58bff", "#d1c2ff", "#7c6cff"] },
  calm:  { emoji: "🌊", colors: ["#5fd3c6", "#a6f0e6", "#3fa7c9"] },
  wild:  { emoji: "🔥", colors: ["#ff4a3d", "#ff8a3d", "#ffc06b"] },
  gold:  { emoji: "🍂", colors: ["#e9c46a", "#f4e1a1", "#c98b4b"] }
};
export const MOOD_KEYS = Object.keys(MOODS);

// Riga "night": anything before 06:00 still belongs to the previous evening.
export function nightId(date = new Date()) {
  const d = new Date(date.getTime() - 6 * 3600 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Riga", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  return parts; // YYYY-MM-DD
}

// ---- seeded helpers ----
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const r = rng(seed);
  const p = new Uint8Array(512);
  const base = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const v = (i, j) => p[(i + p[j & 255]) & 255] / 255;
  const s = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = s(xf), w = s(yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, y) => n(x, y) * 0.65 + n(x * 2.1 + 17, y * 2.1 + 9) * 0.35;
}

// ---- background ----
export function paintBackground(ctx, night) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a0d17");
  g.addColorStop(1, "#0d070c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -H * 0.2, 0, W / 2, -H * 0.2, H * 1.2);
  glow.addColorStop(0, "rgba(255,140,90,0.22)");
  glow.addColorStop(1, "rgba(255,140,90,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // film grain
  const r = rng(hashStr("grain" + night));
  ctx.fillStyle = "rgba(255,240,230,0.035)";
  for (let i = 0; i < 9000; i++) ctx.fillRect(r() * W, r() * H, 1.2, 1.2);
}

// ---- one word → brush strokes ----
export function strokeLayout(stroke) {
  const r = rng(hashStr(stroke.id + "|" + stroke.word));
  return { x: W * (0.1 + r() * 0.8), y: H * (0.14 + r() * 0.72) };
}

export function computeParticles(stroke, night) {
  const noise = fieldFor(night);
  const word = String(stroke.word || "");
  const mood = MOODS[stroke.color] || MOODS.joy;
  const r = rng(hashStr(stroke.id + "|" + word + "|p"));
  const { x: cx, y: cy } = strokeLayout(stroke);
  const charSum = [...word].reduce((a, c) => a + c.charCodeAt(0), 0);
  const curl = ((charSum % 100) / 100 - 0.5) * 1.6;
  const spread = 35 + Math.min(word.length, 20) * 7;
  const count = 34 + (charSum % 18);
  const parts = [];
  for (let k = 0; k < count; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    let x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const steps = 45 + Math.floor(r() * 45);
    const len = 2.5 + r() * 3.5;
    const pts = [x, y];
    for (let i = 0; i < steps; i++) {
      const ang = noise(x * 0.0018, y * 0.0018) * Math.PI * 4 + curl;
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) break;
      pts.push(x, y);
    }
    parts.push({
      pts,
      color: mood.colors[Math.floor(r() * mood.colors.length)],
      width: 0.6 + r() * r() * 3.2,
      alpha: 0.12 + r() * 0.22
    });
  }
  return { cx, cy, color: mood.colors[0], parts };
}

const fields = new Map();
function fieldFor(night) {
  if (!fields.has(night)) fields.set(night, makeNoise(hashStr("field" + night)));
  return fields.get(night);
}

export function drawBloom(ctx, s) {
  ctx.globalCompositeOperation = "screen";
  const g = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, 120);
  g.addColorStop(0, hexA(s.color, 0.16));
  g.addColorStop(1, hexA(s.color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(s.cx - 120, s.cy - 120, 240, 240);
  ctx.globalCompositeOperation = "source-over";
}

export function drawParticle(ctx, p) {
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = hexA(p.color, p.alpha);
  ctx.lineWidth = p.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p.pts[0], p.pts[1]);
  for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

export function drawStrokeInstant(ctx, stroke, night) {
  const s = computeParticles(stroke, night);
  drawBloom(ctx, s);
  s.parts.forEach((p) => drawParticle(ctx, p));
}

// Full painting in one go (used for reloads and for saving).
export function renderAll(ctx, strokes, night) {
  paintBackground(ctx, night);
  for (const s of strokes) drawStrokeInstant(ctx, s, night);
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
