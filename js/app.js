import { firebaseConfig, DEFAULT_BAR, HIDE_AFTER_REPORTS, SDK } from "./firebase-config.js";
import { STRINGS, LANGS, pickLang, saveLang } from "./i18n.js";
import { checkText } from "./filter.js";
import { processPhoto, looksSafe, warmSafetyModel } from "./photo.js";
import { MOODS as PAINT_MOODS, MOOD_KEYS } from "./painting.js";
import { DEFAULT_TARGET, roundKey, makePostcard } from "./rounds.js";

const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const { getAuth, signInAnonymously, onAuthStateChanged } = await import(`${SDK}/firebase-auth.js`);
const {
  getFirestore, collection, doc, query, where, onSnapshot, getDoc,
  writeBatch, serverTimestamp, increment
} = await import(`${SDK}/firebase-firestore.js`);

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ---- params ----
const params = new URLSearchParams(location.search);
const barId = (params.get("bar") || DEFAULT_BAR).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
const table = (params.get("t") || params.get("masa") || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 10);
const paintOnly = params.get("paint") === "1" && !table;

// ---- i18n ----
let lang = pickLang();
const t = (k, vars = {}) =>
  (STRINGS[lang][k] || STRINGS.en[k] || k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");

function renderLangs() {
  const el = document.getElementById("langs");
  el.innerHTML = "";
  for (const l of LANGS) {
    const b = document.createElement("button");
    b.textContent = l;
    if (l === lang) b.className = "on";
    b.onclick = () => { lang = l; saveLang(l); document.documentElement.lang = l; render(); };
    el.appendChild(b);
  }
}

function applyStatic() {
  document.querySelectorAll("[data-t]").forEach((n) => (n.textContent = t(n.dataset.t)));
}

// ---- toast ----
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ---- state ----
let notes = [];
let user = null;
let mood = "";
let photo = null; // { dataUrl, canvas }
let paintMood = "joy";
let curRound = 1, roundTarget = DEFAULT_TARGET, roundCount = 0, barName = "The Snuggest";
const MINE_KEY = "ag_mine";
const loadMine = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || "[]"); } catch { return []; } };
const saveMine = (m) => { try { localStorage.setItem(MINE_KEY, JSON.stringify(m.slice(-20))); } catch {} };
const keepsakes = new Map(); // roundNum -> { round doc, image }
const photoCache = new Map();
const MOODS = ["✨", "🍷", "💛", "😂", "🌙", "🎶"];

function timeAgo(ts) {
  if (!ts) return "";
  const sec = Math.round((ts.toMillis() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, s] of units) if (Math.abs(sec) >= s) return rtf.format(Math.round(sec / s), u);
  return rtf.format(0, "minute");
}

// stable pseudo-random tilt per note
const tilt = (id) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 50) - 25) / 10; // -2.5deg .. 2.5deg
};

function noteEl(n) {
  const card = document.createElement("article");
  card.className = "note";
  card.style.setProperty("--tilt", `${tilt(n.id)}deg`);

  const text = document.createElement("div");
  text.className = "text";
  text.textContent = (n.mood ? n.mood + " " : "") + n.text;

  const meta = document.createElement("div");
  meta.className = "meta";
  const who = document.createElement("span");
  who.innerHTML = `<span class="who"></span> · <span class="when"></span>`;
  who.querySelector(".who").textContent = n.nick || t("anon");
  who.querySelector(".when").textContent = timeAgo(n.createdAt);

  const rep = document.createElement("button");
  rep.className = "report";
  rep.textContent = "⚑ " + t("report");
  rep.onclick = () => {
    if (!rep.classList.contains("sure")) {
      rep.classList.add("sure");
      rep.textContent = t("reportSure");
      setTimeout(() => { rep.classList.remove("sure"); rep.textContent = "⚑ " + t("report"); }, 4000);
      return;
    }
    reportNote(n.id, rep);
  };

  meta.append(who, rep);
  if (n.hasPhoto) {
    const img = document.createElement("img");
    img.className = "photo";
    img.alt = "";
    card.appendChild(img);
    loadPhoto(n.id).then((src) => { if (src) img.src = src; else img.remove(); });
  }
  if (n.text || n.mood) card.appendChild(text);
  card.append(meta);
  return card;
}

function render() {
  renderLangs();
  applyStatic();
  const app = document.getElementById("app");

  if (!table) {
    if (paintOnly) {
      app.innerHTML = `<h1 class="table-name">✦</h1><a class="gal-btn" id="galLink"></a><section id="paint"></section>`;
      app.querySelector("#galLink").textContent = t("galleryBtn");
      app.querySelector("#galLink").href = `gallery.html?bar=${encodeURIComponent(barId)}`;
      renderPaint();
      return;
    }
    app.innerHTML = `<h1 class="table-name">✦</h1><p class="intro"></p>`;
    app.querySelector(".intro").textContent = t("noTable");
    return;
  }

  // keep draft text when re-rendering (e.g. language switch)
  const draft = document.getElementById("text")?.value || "";
  const nickDraft = document.getElementById("nick")?.value || "";

  app.innerHTML = `
    <h1 class="table-name"></h1>
    <p class="intro"></p>
    <a class="gal-btn" id="galLink"></a>
    <section id="paint"></section>
    <section class="notes" id="notes"></section>
    <section class="compose">
      <h2></h2>
      <textarea id="text" maxlength="280"></textarea>
      <div class="photo-pick">
        <label class="pick-btn"><input type="file" id="file" accept="image/*" hidden><span id="pickLabel"></span></label>
        <div id="preview" class="preview"></div>
      </div>
      <div class="moods" id="moods"></div>
      <input id="nick" maxlength="24" autocomplete="off">
      <div class="row" style="margin-top:14px">
        <span class="count" id="count">0/280</span>
        <button class="send" id="send"></button>
      </div>
    </section>`;

  app.querySelector(".table-name").textContent = t("table", { n: table });
  app.querySelector(".intro").textContent = t("intro");
  const gl = app.querySelector("#galLink");
  gl.textContent = t("galleryBtn");
  gl.href = `gallery.html?bar=${encodeURIComponent(barId)}`;
  app.querySelector(".compose h2").textContent = t("composeTitle");

  const ta = app.querySelector("#text");
  ta.placeholder = t("placeholder");
  ta.value = draft;
  const nick = app.querySelector("#nick");
  nick.placeholder = t("nick");
  nick.value = nickDraft;

  const count = app.querySelector("#count");
  const send = app.querySelector("#send");
  send.textContent = t("send");
  const upd = () => { count.textContent = `${ta.value.length}/280`; send.disabled = !(ta.value.trim() || photo) || !user; };
  ta.oninput = upd;
  upd();
  send.onclick = submit;

  const moodsEl = app.querySelector("#moods");
  for (const m of MOODS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = m;
    if (m === mood) b.className = "on";
    b.onclick = () => { mood = mood === m ? "" : m; render(); };
    moodsEl.appendChild(b);
  }

  app.querySelector("#pickLabel").textContent = t("addPhoto");
  const file = app.querySelector("#file");
  file.onchange = async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    warmSafetyModel();
    toast(t("processing"));
    try {
      photo = await processPhoto(f);
      renderPreview();
      upd();
    } catch (e) { console.error(e); toast(t("photoError")); }
  };
  renderPreview();
  renderPaint();

  renderNotes();
}

function renderPaint() {
  const el = document.getElementById("paint");
  if (!el) return;
  const draft = document.getElementById("pword")?.value || "";
  el.className = "paint";
  el.innerHTML = `<div id="keeps"></div><h2></h2><p class="hint"></p>
    <div class="pprog"><i style="width:${Math.min(100, (roundCount / roundTarget) * 100)}%"></i></div>
    <p class="pcount"></p>
    <div class="swatches" id="sw"></div>
    <div class="paint-row"><input id="pword" maxlength="20" autocomplete="off"><button class="send" id="psend"></button></div>`;
  el.querySelector(".pcount").textContent = t("progress", { n: roundCount, target: roundTarget, left: Math.max(0, roundTarget - roundCount) });
  renderKeepsakes();
  el.querySelector("h2").textContent = t("paintTitle");
  el.querySelector(".hint").textContent = t("paintHint");
  const sw = el.querySelector("#sw");
  for (const k of MOOD_KEYS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sw" + (k === paintMood ? " on" : "");
    b.style.setProperty("--c", PAINT_MOODS[k].colors[0]);
    b.textContent = `${PAINT_MOODS[k].emoji} ${t("mood_" + k)}`;
    b.onclick = () => { paintMood = k; renderPaint(); };
    sw.appendChild(b);
  }
  const inp = el.querySelector("#pword");
  inp.placeholder = t("paintPlaceholder");
  inp.value = draft;
  const btn = el.querySelector("#psend");
  btn.textContent = t("paintSend");
  inp.onkeydown = (e) => { if (e.key === "Enter") sendWord(); };
  btn.onclick = sendWord;
}

async function sendWord() {
  const inp = document.getElementById("pword");
  const word = inp.value.trim().replace(/\s+/g, " ");
  if (!word || !user) return;
  const problem = checkText(word);
  if (problem) { toast(t(problem)); return; }
  const btn = document.getElementById("psend");
  btn.disabled = true;
  const batch = writeBatch(db);
  const data = { word, color: paintMood, createdAt: serverTimestamp(), uid: user.uid };
  if (table) data.table = table;
  const ref = doc(collection(db, "bars", barId, "rounds", roundKey(curRound), "strokes"));
  batch.set(ref, data);
  batch.set(doc(db, "strokeLimits", user.uid), { last: serverTimestamp() });
  try {
    await batch.commit();
    inp.value = "";
    toast(t("painted"));
    const mine = loadMine();
    mine.push({ bar: barId, r: curRound, w: word });
    saveMine(mine);
    watchMyRounds();
  } catch (e) {
    console.error(e);
    toast(e.code === "permission-denied" ? t("paintTooFast") : t("error"));
  }
  btn.disabled = false;
}

function renderPreview() {
  const el = document.getElementById("preview");
  if (!el) return;
  el.innerHTML = "";
  if (!photo) return;
  const img = document.createElement("img");
  img.src = photo.dataUrl;
  const x = document.createElement("button");
  x.type = "button";
  x.className = "remove";
  x.textContent = "✕ " + t("removePhoto");
  x.onclick = () => { photo = null; renderPreview(); document.getElementById("text").oninput(); };
  el.append(img, x);
}

async function loadPhoto(noteId) {
  if (photoCache.has(noteId)) return photoCache.get(noteId);
  const p = getDoc(doc(db, "bars", barId, "photos", noteId))
    .then((s) => (s.exists() ? s.data().data : null))
    .catch(() => null);
  photoCache.set(noteId, p);
  return p;
}

function renderNotes() {
  const el = document.getElementById("notes");
  if (!el) return;
  el.innerHTML = "";
  const visible = notes.filter((n) => (n.reportCount || 0) < HIDE_AFTER_REPORTS);
  if (!visible.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = t("empty");
    el.appendChild(e);
    return;
  }
  visible.forEach((n) => el.appendChild(noteEl(n)));
}

// ---- living painting: rounds + keepsakes ----
let countUnsub = null, countRound = null;
function watchBar() {
  onSnapshot(doc(db, "bars", barId), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    curRound = d.currentRound || 1;
    roundTarget = Math.min(30, Math.max(20, d.roundTarget || DEFAULT_TARGET));
    if (d.name) barName = d.name;
    if (countRound !== curRound) {
      countRound = curRound;
      countUnsub?.();
      countUnsub = onSnapshot(collection(db, "bars", barId, "rounds", roundKey(curRound), "strokes"), (s) => {
        roundCount = s.size;
        updateProgress();
      });
    }
    updateProgress();
  });
}
function updateProgress() {
  const el = document.getElementById("paint");
  if (!el) return;
  const bar = el.querySelector(".pprog i");
  const txt = el.querySelector(".pcount");
  if (bar) bar.style.width = `${Math.min(100, (roundCount / roundTarget) * 100)}%`;
  if (txt) txt.textContent = t("progress", { n: roundCount, target: roundTarget, left: Math.max(0, roundTarget - roundCount) });
}

const watched = new Set();
function watchMyRounds() {
  const mine = loadMine().filter((m) => m.bar === barId);
  const rounds = [...new Set(mine.map((m) => m.r))].slice(-3);
  for (const r of rounds) {
    if (watched.has(r)) continue;
    watched.add(r);
    onSnapshot(doc(db, "bars", barId, "rounds", roundKey(r)), async (snap) => {
      const d = snap.data();
      if (!d) return;
      if (d.status === "done" && !keepsakes.get(r)?.image) {
        const img = await getDoc(doc(db, "bars", barId, "roundImages", roundKey(r)));
        keepsakes.set(r, { round: d, image: img.exists() ? img.data().data : null });
      } else if (d.status === "generating") {
        keepsakes.set(r, { round: d, image: null });
      }
      renderKeepsakes();
    });
  }
}

function renderKeepsakes() {
  const box = document.getElementById("keeps");
  if (!box) return;
  box.innerHTML = "";
  const mine = loadMine().filter((m) => m.bar === barId);
  for (const [r, k] of [...keepsakes.entries()].sort((a, b) => b[0] - a[0])) {
    const card = document.createElement("div");
    card.className = "keep";
    if (!k.image) {
      card.innerHTML = `<p class="kwait"></p>`;
      card.querySelector(".kwait").textContent = t("revealSoon");
      box.appendChild(card);
      continue;
    }
    const myWords = mine.filter((m) => m.r === r).map((m) => m.w);
    const others = Math.max(0, (k.round.count || 1) - 1);
    card.innerHTML = `<h3></h3><img alt=""><p class="ktext"></p><button class="send kbtn"></button>`;
    card.querySelector("h3").textContent = t("keepTitle");
    card.querySelector("img").src = k.image;
    card.querySelector(".ktext").textContent = t("keepText", { n: others, w: myWords.join(", ") });
    const btn = card.querySelector(".kbtn");
    btn.textContent = t("keepBtn");
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const date = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "2-digit", year: "numeric" })
          .format(k.round.closedAt?.toDate?.() || new Date());
        const blob = await makePostcard({
          image: k.image, words: k.round.words || [], mine: myWords, n: r,
          count: k.round.count || (k.round.words || []).length, barName, date,
          line: t("postcardLine", { n: others })
        });
        const file = new File([blob], `afterglow-${barId}-${r}.jpg`, { type: "image/jpeg" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "Afterglow" }).catch(() => {});
        } else {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
      } catch (e) { console.error(e); toast(t("error")); }
      btn.disabled = false;
    };
    box.appendChild(card);
  }
}

// ---- data ----
let requireApproval = false;

async function loadBar() {
  try {
    const snap = await getDoc(doc(db, "bars", barId));
    requireApproval = snap.exists() && snap.data().requireApproval === true;
  } catch { requireApproval = false; }
}

function listen() {
  const q = query(
    collection(db, "bars", barId, "notes"),
    where("table", "==", table),
    where("status", "==", "visible")
  );
  onSnapshot(q, (snap) => {
    notes = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis() || Date.now()) - (a.createdAt?.toMillis() || Date.now()));
    renderNotes();
  }, (err) => { console.error(err); toast(t("error")); });
}

async function submit() {
  const ta = document.getElementById("text");
  const nickEl = document.getElementById("nick");
  const text = ta.value.trim();
  const nick = nickEl.value.trim();
  if (!(text || photo) || !user) return;

  const problem = (text && checkText(text)) || (nick && checkText(nick));
  if (problem) { toast(t(problem)); return; }

  const send = document.getElementById("send");
  send.disabled = true;

  if (photo && !(await looksSafe(photo.canvas))) {
    toast(t("photoBlocked"));
    photo = null;
    renderPreview();
    send.disabled = false;
    return;
  }
  const withPhoto = !!photo;

  const batch = writeBatch(db);
  const noteRef = doc(collection(db, "bars", barId, "notes"));
  const data = {
    table, text,
    status: requireApproval || withPhoto ? "pending" : "visible",
    reportCount: 0,
    createdAt: serverTimestamp(),
    uid: user.uid
  };
  if (nick) data.nick = nick;
  if (mood) data.mood = mood;
  if (withPhoto) data.hasPhoto = true;
  batch.set(noteRef, data);
  if (withPhoto) {
    batch.set(doc(db, "bars", barId, "photos", noteRef.id), {
      data: photo.dataUrl, createdAt: serverTimestamp(), uid: user.uid
    });
  }
  batch.set(doc(db, "rateLimits", user.uid), { last: serverTimestamp() });

  try {
    await batch.commit();
    ta.value = "";
    mood = "";
    photo = null;
    toast(withPhoto ? t("photoPending") : requireApproval ? t("pending") : t("sent"));
    render();
  } catch (e) {
    console.error(e);
    toast(e.code === "permission-denied" ? t("tooFast") : t("error"));
    send.disabled = false;
  }
}

async function reportNote(noteId, btn) {
  if (!user) return;
  btn.disabled = true;
  const batch = writeBatch(db);
  batch.set(doc(db, "bars", barId, "notes", noteId, "reports", user.uid), { createdAt: serverTimestamp() });
  batch.update(doc(db, "bars", barId, "notes", noteId), { reportCount: increment(1) });
  try {
    await batch.commit();
  } catch (e) {
    // already reported by this device → treat as success
    console.warn(e);
  }
  toast(t("reported"));
  btn.textContent = "✓";
}

// ---- boot ----
document.documentElement.lang = lang;
render();

onAuthStateChanged(auth, (u) => {
  user = u;
  const send = document.getElementById("send");
  const ta = document.getElementById("text");
  if (send && ta) send.disabled = !(ta.value.trim() || photo) || !user;
});

try {
  // Keep any existing session (e.g. the admin's Google login on this phone);
  // only create an anonymous one when nobody is signed in.
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
} catch (e) {
  console.error("Anonymous sign-in failed — is it enabled in Firebase Auth?", e);
  toast(t("error"));
}

if (table) {
  await loadBar();
  listen();
}
if (paintOnly) render();
watchBar();
watchMyRounds();
