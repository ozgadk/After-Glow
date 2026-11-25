// Rounds: guests' words are collected until the round's target (20–30) is hit,
// then an image is generated from the words and the next round opens.
// Image: Pollinations (free, no key, rate-limited). If it fails, the abstract
// flow-field painting of the same words is used instead, so every round ends
// with a picture.
import { W, H, renderAll, hashStr, MOODS } from "./painting.js";

export const DEFAULT_TARGET = 24;
export const roundKey = (n) => `r${n}`;

const MOOD_WORDS = {
  joy: "joyful, golden sparkle",
  love: "tender, romantic rose light",
  dream: "dreamy, violet moonlight",
  calm: "calm, soft teal haze",
  wild: "wild energy, fiery reds",
  gold: "nostalgic, autumn gold"
};

export function buildPrompt(strokes) {
  const seen = new Set();
  const words = [];
  for (const s of strokes) {
    const w = String(s.word || "").trim();
    const k = w.toLowerCase();
    if (w && !seen.has(k)) { seen.add(k); words.push(w); }
  }
  const counts = {};
  strokes.forEach((s) => (counts[s.color] = (counts[s.color] || 0) + 1));
  const moods = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k]) => MOOD_WORDS[k]).filter(Boolean);
  return [
    "A painterly oil painting, one coherent dreamlike scene inspired by these words from strangers in a cosy bar in Riga Old Town at night:",
    words.slice(0, 30).join(", ") + ".",
    `Mood: ${moods.join("; ")}.`,
    "Warm amber and rose afterglow light, visible brushstrokes, rich colours, cinematic composition, wholesome, no text, no letters, no words, no watermark."
  ].join(" ");
}

export function imageUrl(prompt, seed) {
  const q = new URLSearchParams({ width: "1344", height: "768", seed: String(seed), model: "flux", nologo: "true", safe: "true" });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`;
}

async function fetchAsDataUrl(url, timeoutMs = 120000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const s = Math.max(W / bmp.width, H / bmp.height);
    const w = bmp.width * s, h = bmp.height * s;
    ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
    return toJpeg(c);
  } finally { clearTimeout(timer); }
}

export function toJpeg(canvas, max = 900000) {
  let q = 0.88, d = canvas.toDataURL("image/jpeg", q);
  while (d.length > max && q > 0.4) { q -= 0.08; d = canvas.toDataURL("image/jpeg", q); }
  return d;
}

function abstractFallback(strokes, key) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  renderAll(c.getContext("2d"), strokes, key);
  return toJpeg(c);
}

// fs = { doc, setDoc, updateDoc, runTransaction, serverTimestamp }
// Closes round `n` (if still current), opens n+1, then generates the image.
export async function finishRound(db, fs, barId, n, strokes, { force = false } = {}) {
  const barRef = fs.doc(db, "bars", barId);
  const roundRef = fs.doc(db, "bars", barId, "rounds", roundKey(n));
  const prompt = buildPrompt(strokes);
  const seed = hashStr(barId + roundKey(n)) % 1000000;
  const words = strokes.map((s) => ({ w: s.word, c: s.color, t: s.table || "" }));

  await fs.runTransaction(db, async (tx) => {
    const b = await tx.get(barRef);
    const cur = b.exists() ? b.data().currentRound || 1 : 1;
    if (cur !== n && !force) throw new Error("already-finished");
    tx.set(barRef, { currentRound: n + 1 }, { merge: true });
    tx.set(roundRef, { status: "generating", n, words, count: words.length, prompt, seed, closedAt: fs.serverTimestamp() }, { merge: true });
  });

  await generateImage(db, fs, barId, n, strokes, prompt, seed);
}

export async function generateImage(db, fs, barId, n, strokes, prompt, seed) {
  const roundRef = fs.doc(db, "bars", barId, "rounds", roundKey(n));
  const url = imageUrl(prompt, seed);
  let data = null, source = "ai";
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    try { data = await fetchAsDataUrl(url); }
    catch (e) {
      console.warn("AI image failed", e);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 20000)); // free tier: 1 request / 15 s
    }
  }
  if (!data) { data = abstractFallback(strokes, barId + roundKey(n)); source = "abstract"; }
  await fs.setDoc(fs.doc(db, "bars", barId, "roundImages", roundKey(n)), { data, updatedAt: fs.serverTimestamp() });
  await fs.updateDoc(roundRef, { status: "done", source, imageUrl: url, doneAt: fs.serverTimestamp() });
  return { data, source };
}

export async function regenerate(db, fs, barId, n, strokes, prompt) {
  const seed = Math.floor(Math.random() * 1000000);
  await fs.updateDoc(fs.doc(db, "bars", barId, "rounds", roundKey(n)), { status: "generating", seed });
  return generateImage(db, fs, barId, n, strokes, prompt, seed);
}

// ---- keepsake postcard (1080×1920, story format) ----
export async function makePostcard({ image, words, mine, n, count, barName, date, line, tag = "" }) {
  await Promise.all([
    document.fonts.load('600 64px "Fraunces"'),
    document.fonts.load('500 48px "Caveat"'),
    document.fonts.load('400 28px "Inter"')
  ]).catch(() => {});
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1920;
  const x = c.getContext("2d");
  const bg = x.createLinearGradient(0, 0, 0, 1920);
  bg.addColorStop(0, "#1d1019"); bg.addColorStop(1, "#0d070c");
  x.fillStyle = bg; x.fillRect(0, 0, 1080, 1920);
  const glow = x.createRadialGradient(540, -200, 0, 540, -200, 1300);
  glow.addColorStop(0, "rgba(255,140,90,0.35)"); glow.addColorStop(1, "rgba(255,140,90,0)");
  x.fillStyle = glow; x.fillRect(0, 0, 1080, 1920);

  // title
  const grad = x.createLinearGradient(80, 0, 600, 0);
  grad.addColorStop(0, "#ffb36b"); grad.addColorStop(1, "#ff6f8e");
  x.fillStyle = grad; x.font = '600 64px "Fraunces", Georgia, serif';
  x.fillText("Afterglow", 80, 150);
  x.fillStyle = "#c9b3a8"; x.font = '400 28px "Inter", sans-serif';
  x.fillText(`${barName} · Rīga · ${date}`.toUpperCase(), 80, 200);

  // image on "paper" with tape — cropped to 4:5 so it fills the card
  const img = await loadImg(image);
  const pw = 900, ph = 1000;
  const top = 270;
  x.save();
  x.translate(540, top + ph / 2);
  x.rotate(-0.018);
  x.fillStyle = "#fff3e0";
  x.shadowColor = "rgba(0,0,0,0.5)"; x.shadowBlur = 40; x.shadowOffsetY = 16;
  x.fillRect(-pw / 2 - 22, -ph / 2 - 22, pw + 44, ph + 44);
  x.shadowColor = "transparent";
  const sc = Math.max(pw / img.width, ph / img.height);
  const sw = pw / sc, sh = ph / sc;
  x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, -pw / 2, -ph / 2, pw, ph);
  x.fillStyle = "rgba(255,200,150,0.75)";
  x.fillRect(-90, -ph / 2 - 44, 180, 46);
  x.restore();

  // text block: sized to the number of words, centred in the space left
  const areaTop = top + ph + 60, areaBottom = 1800;
  const n0 = words.length;
  const base = n0 <= 6 ? 64 : n0 <= 12 ? 54 : n0 <= 20 ? 46 : 40;
  const layout = [];
  let lx = 0, ly = 0;
  const lineH = Math.round(base * 1.45), maxW = 920;
  for (const w of words) {
    const isMine = mine.some((m) => m.toLowerCase() === String(w.w).toLowerCase());
    const size = isMine ? Math.round(base * 1.35) : base + (hashStr(w.w) % 8) - 4;
    x.font = `500 ${size}px "Caveat", cursive`;
    const tw = x.measureText(w.w).width;
    if (lx > 0 && lx + tw > maxW) { lx = 0; ly += lineH; }
    layout.push({ w, isMine, size, x: lx, y: ly, tw });
    lx += tw + 30;
  }
  const cloudH = (layout.length ? ly + lineH : 0);
  const headH = 150;
  const blockH = headH + cloudH;
  let y0 = areaTop + Math.max(0, (areaBottom - areaTop - blockH) / 2);

  x.fillStyle = "#ffd2a8"; x.font = '500 62px "Caveat", cursive';
  x.fillText(line, 80, y0 + 60);
  x.fillStyle = "#8f7a72"; x.font = '400 26px "Inter", sans-serif';
  x.fillText(`#${n} · ${count} words`, 80, y0 + 104);

  const cy = y0 + headH + base;
  for (const L of layout) {
    const yy = cy + L.y;
    if (yy > areaBottom) break;
    x.font = `500 ${L.size}px "Caveat", cursive`;
    x.fillStyle = L.isMine ? "#ffb36b" : (MOODS[L.w.c]?.colors[1] || "#e6d3c8");
    x.globalAlpha = L.isMine ? 1 : 0.85;
    x.fillText(L.w.w, 80 + L.x, yy);
    if (L.isMine) x.fillRect(80 + L.x, yy + 12, L.tw, 5);
    x.globalAlpha = 1;
  }
  if (tag) {
    const tg = x.createLinearGradient(80, 0, 900, 0);
    tg.addColorStop(0, "#ffb36b"); tg.addColorStop(1, "#ff6f8e");
    x.fillStyle = tg; x.font = '600 34px "Inter", sans-serif';
    x.fillText(tag, 80, 1878);
  } else {
    x.fillStyle = "#6f5d57"; x.font = '400 22px "Inter", sans-serif';
    x.fillText("afterglow.thesnuggest.com", 80, 1880);
  }
  return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
}

function loadImg(src) {
  return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
}
