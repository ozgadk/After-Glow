// "← Admin" button for pages opened from the admin app (nav buttons add from=admin,
// app shortcuts add source=app). Guests never see it.
const q = new URLSearchParams(location.search);
// Remembered for the tab, so links inside these pages (e.g. guest page → gallery) keep it.
const KEY = "afterglow-from-admin";
let remembered = false;
try { remembered = sessionStorage.getItem(KEY) === "1"; } catch {}
const fromApp = remembered || q.get("from") === "admin" || q.get("source") === "app"
  || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (fromApp) try { sessionStorage.setItem(KEY, "1"); } catch {}
if (fromApp) {
  const bar = q.get("bar") || "snuggest";
  const a = document.createElement("a");
  a.href = `admin.html?bar=${encodeURIComponent(bar)}&source=app`;
  a.textContent = "← Admin";
  a.setAttribute("aria-label", "Back to admin");
  a.style.cssText = [
    "position:fixed", "z-index:2147483000", "top:calc(env(safe-area-inset-top, 0px) + 10px)", "left:10px",
    "padding:8px 14px", "border-radius:999px", "background:rgba(18,10,16,0.82)", "color:#fff3e0",
    "border:1px solid rgba(255,179,107,0.6)", "font:600 14px Inter, system-ui, sans-serif", "text-decoration:none",
    "box-shadow:0 4px 14px rgba(0,0,0,0.4)", "transition:opacity .6s", "cursor:pointer", "-webkit-tap-highlight-color:transparent"
  ].join(";");
  document.body.appendChild(a);
  // links to other Afterglow pages open in the same window and keep from=admin
  addEventListener("click", (e) => {
    const l = e.target.closest?.("a[href]");
    if (!l || l === a) return;
    const u = new URL(l.href, location.href);
    if (u.origin !== location.origin || !/\.html$/.test(u.pathname) || /admin\.html$/.test(u.pathname)) return;
    u.searchParams.set("from", "admin");
    l.href = u.href; l.removeAttribute("target");
  }, true);
  // push page content down so the button never covers the header (not on the TV screen)
  if (!/screen\.html$/.test(location.pathname)) document.body.style.paddingTop = "calc(env(safe-area-inset-top, 0px) + 52px)";
  // on the bar TV keep it out of the way: fade out, come back on mouse move / tap
  if (/screen\.html$/.test(location.pathname)) {
    let t;
    const show = () => { a.style.opacity = "1"; document.body.style.cursor = "auto"; clearTimeout(t); t = setTimeout(() => { a.style.opacity = "0"; document.body.style.cursor = ""; }, 4000); };
    ["mousemove", "touchstart", "keydown"].forEach((e) => addEventListener(e, show, { passive: true }));
    show();
  }
}
