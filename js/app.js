import { firebaseConfig, DEFAULT_BAR, HIDE_AFTER_REPORTS, SDK } from "./firebase-config.js";
import { STRINGS, LANGS, pickLang, saveLang } from "./i18n.js";
import { checkText } from "./filter.js";

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
  card.append(text, meta);
  return card;
}

function render() {
  renderLangs();
  applyStatic();
  const app = document.getElementById("app");

  if (!table) {
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
    <section class="notes" id="notes"></section>
    <section class="compose">
      <h2></h2>
      <textarea id="text" maxlength="280"></textarea>
      <div class="moods" id="moods"></div>
      <input id="nick" maxlength="24" autocomplete="off">
      <div class="row" style="margin-top:14px">
        <span class="count" id="count">0/280</span>
        <button class="send" id="send"></button>
      </div>
    </section>`;

  app.querySelector(".table-name").textContent = t("table", { n: table });
  app.querySelector(".intro").textContent = t("intro");
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
  const upd = () => { count.textContent = `${ta.value.length}/280`; send.disabled = !ta.value.trim() || !user; };
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

  renderNotes();
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
  if (!text || !user) return;

  const problem = checkText(text) || (nick && checkText(nick));
  if (problem) { toast(t(problem)); return; }

  const send = document.getElementById("send");
  send.disabled = true;

  const batch = writeBatch(db);
  const noteRef = doc(collection(db, "bars", barId, "notes"));
  const data = {
    table, text,
    status: requireApproval ? "pending" : "visible",
    reportCount: 0,
    createdAt: serverTimestamp(),
    uid: user.uid
  };
  if (nick) data.nick = nick;
  if (mood) data.mood = mood;
  batch.set(noteRef, data);
  batch.set(doc(db, "rateLimits", user.uid), { last: serverTimestamp() });

  try {
    await batch.commit();
    ta.value = "";
    mood = "";
    toast(requireApproval ? t("pending") : t("sent"));
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
  if (send && ta) send.disabled = !ta.value.trim() || !user;
});

try {
  await signInAnonymously(auth);
} catch (e) {
  console.error("Anonymous sign-in failed — is it enabled in Firebase Auth?", e);
  toast(t("error"));
}

if (table) {
  await loadBar();
  listen();
}
