// Publishes firestore.rules via the Firebase Rules REST API.
// Uses the service account in GOOGLE_APPLICATION_CREDENTIALS.
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIREBASE_PROJECT;
const BASE = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;
const RELEASE = `projects/${PROJECT}/releases/cloud.firestore`;

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const client = await auth.getClient();

async function call(method, url, data) {
  try {
    return (await client.request({ method, url, data })).data;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    const err = new Error(`${method} ${url.replace(BASE, "")}: ${e.response?.status || ""} ${msg}`);
    err.status = e.response?.status;
    throw err;
  }
}

try {
  const content = readFileSync("firestore.rules", "utf8");
  const ruleset = await call("POST", `${BASE}/rulesets`, {
    source: { files: [{ name: "firestore.rules", content }] }
  });
  console.log("Created ruleset", ruleset.name);

  try {
    await call("PATCH", `${BASE}/releases/cloud.firestore`, {
      release: { name: RELEASE, rulesetName: ruleset.name }
    });
  } catch (e) {
    if (e.status !== 404) throw e;
    await call("POST", `${BASE}/releases`, { name: RELEASE, rulesetName: ruleset.name });
  }
  console.log("Released to cloud.firestore ✔");
} catch (e) {
  console.log(`::error::${String(e.message).replace(/%/g, "%25").replace(/\r?\n/g, " ")}`);
  process.exit(1);
}
