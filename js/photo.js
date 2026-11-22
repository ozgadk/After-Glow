// Photo pipeline: resize → Afterglow tone → JPEG (re-encoding strips EXIF/GPS).
// Plus an on-device nudity check (nsfw.js). The check is a first line of
// defence only — every photo still waits for admin approval.

const MAX_EDGE = 1080;
const MAX_DATAURL = 850_000; // keeps the Firestore doc well under its 1 MiB limit

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  }
}

export function afterglowTone(ctx, w, h) {
  // warm soft-light wash: amber top-left → rose bottom-right
  ctx.globalCompositeOperation = "soft-light";
  const wash = ctx.createLinearGradient(0, 0, w, h);
  wash.addColorStop(0, "rgba(255,179,107,0.55)");
  wash.addColorStop(1, "rgba(255,111,142,0.45)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  // lift shadows slightly toward plum (filmic, never pure black)
  ctx.globalCompositeOperation = "lighten";
  ctx.fillStyle = "rgba(42,18,32,1)";
  ctx.fillRect(0, 0, w, h);

  // glow from above, like a warm lamp
  ctx.globalCompositeOperation = "screen";
  const glow = ctx.createRadialGradient(w * 0.5, -h * 0.1, 0, w * 0.5, -h * 0.1, Math.max(w, h) * 0.9);
  glow.addColorStop(0, "rgba(255,170,110,0.28)");
  glow.addColorStop(1, "rgba(255,170,110,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // vignette
  ctx.globalCompositeOperation = "multiply";
  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vig.addColorStop(0, "rgba(255,255,255,1)");
  vig.addColorStop(1, "rgba(60,25,40,1)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = "source-over";
}

// Returns { dataUrl, canvas }
export async function processPhoto(file) {
  const src = await loadBitmap(file);
  const sw = src.width, sh = src.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.filter = "saturate(1.08) contrast(1.05)"; // ignored where unsupported
  ctx.drawImage(src, 0, 0, w, h);
  ctx.filter = "none";
  afterglowTone(ctx, w, h);

  let q = 0.8, dataUrl = canvas.toDataURL("image/jpeg", q);
  while (dataUrl.length > MAX_DATAURL && q > 0.4) {
    q -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", q);
  }
  if (dataUrl.length > MAX_DATAURL) throw new Error("too-big");
  return { dataUrl, canvas };
}

// ---- on-device safety check ----
const TF = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const NSFW = "https://cdn.jsdelivr.net/npm/nsfwjs@4.4.0/dist/browser/nsfwjs.min.js";
let modelPromise = null;

const addScript = (src) => new Promise((ok, no) => {
  const s = document.createElement("script");
  s.src = src; s.crossOrigin = "anonymous"; s.onload = ok; s.onerror = no;
  document.head.appendChild(s);
});

export function warmSafetyModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      if (!window.tf) await addScript(TF);
      if (!window.nsfwjs) await addScript(NSFW);
      return window.nsfwjs.load("MobileNetV2");
    })().catch((e) => { console.warn("Safety model unavailable", e); modelPromise = null; return null; });
  }
  return modelPromise;
}

// true = looks OK (or the check could not run), false = likely explicit
export async function looksSafe(canvas) {
  const model = await warmSafetyModel();
  if (!model) return true; // fail open: admin approval still applies
  try {
    const preds = await model.classify(canvas);
    const p = Object.fromEntries(preds.map((x) => [x.className, x.probability]));
    return (p.Porn || 0) + (p.Hentai || 0) < 0.6 && (p.Sexy || 0) < 0.85;
  } catch (e) {
    console.warn(e);
    return true;
  }
}
