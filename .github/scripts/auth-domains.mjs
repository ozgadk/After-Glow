// Adds the domains in .github/auth-domains.txt to Firebase Auth's authorized domains
// via the Identity Toolkit Admin API. Uses the service account in GOOGLE_APPLICATION_CREDENTIALS.
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIREBASE_PROJECT;
const URL = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;

const wanted = readFileSync(".github/auth-domains.txt", "utf8")
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const client = await auth.getClient();
const headers = { "x-goog-user-project": PROJECT };

try {
  const cfg = (await client.request({ url: URL, headers })).data;
  const have = cfg.authorizedDomains || [];
  console.log("Current:", have.join(", "));
  const missing = wanted.filter((d) => !have.includes(d));
  if (!missing.length) { console.log("Nothing to add ✔"); process.exit(0); }
  const res = await client.request({
    method: "PATCH", url: `${URL}?updateMask=authorizedDomains`, headers,
    data: { authorizedDomains: [...have, ...missing] }
  });
  console.log("Added:", missing.join(", "));
  console.log("Now:", res.data.authorizedDomains.join(", "), "✔");
} catch (e) {
  const msg = e.response?.data?.error?.message || e.message;
  console.log(`::error::${e.response?.status || ""} ${String(msg).replace(/\r?\n/g, " ")}`);
  process.exit(1);
}
