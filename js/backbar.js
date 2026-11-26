// "← Admin" button for pages opened from the admin app (nav buttons add from=admin,
// app shortcuts add source=app). Guests never see it.
const q = new URLSearchParams(location.search);
const fromApp = q.get("from") === "admin" || q.get("source") === "app"
  || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
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
