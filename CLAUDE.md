# Afterglow — project guide

Bar socialising web app. Built first for **The Snuggest** (Zirgu iela 3, Old Town Rīga),
meant to be sold to other venues later. Owner: Özgür (ozgadk). He writes in Turkish;
reply to him in Turkish, keep it short and practical, and be honest about what wasn't tested.

## Stack
- Static site on **GitHub Pages**: https://afterglow.thesnuggest.com/ (custom domain via `CNAME`;
  old https://ozgadk.github.io/After-Glow/ links redirect there). Branch `main`, root. All paths are relative.
- **Firebase** project `after-glow-42465` (free Spark plan): Firestore + Auth
  (Anonymous for guests, Google for admins). Config in `js/firebase-config.js` (public by design).
- Firebase JS SDK 10.12.2 from gstatic (ES modules, no build step, no npm in the app).
- No bundler: plain HTML + ES modules. Keep it that way.

## Pages
| File | Purpose |
|---|---|
| `index.html?bar=snuggest&t=5` | Guest table page (QR on each of the 12 tables). Notes + photos, painting word input, keepsake postcards, gallery button |
| `index.html?bar=snuggest&paint=1` | Painting-only page (QR on the bar screen) |
| `screen.html?bar=snuggest` | Bar TV: Living Painting. Signed-in admin = host mode (closes rounds). Never static: drifting embers on the flow field, slow camera drift, earlier words echo after 15 s quiet, after 3 min quiet a slideshow of earlier finished paintings (any new word interrupts) |
| `admin.html?bar=snuggest` | Moderation: notes/photos, painting words, rounds, wall poster fill |
| `gallery.html?bar=snuggest` | AR wall gallery (MindAR) + plain browse view |

## Code map
- `js/app.js` guest page · `js/i18n.js` EN/LV/RU/TR strings · `js/filter.js` client word filter
- `js/photo.js` resize + "Afterglow tone" + EXIF strip + nsfw.js check (CDN)
- `js/painting.js` deterministic flow-field renderer (seeded by word + round)
- `js/rounds.js` round close (transaction), prompt building, Pollinations image
  (free, no key; falls back to abstract painting), regenerate, postcard (1080×1920)
- `css/style.css` shared styles (dark plum, amber→rose gradient; Fraunces / Caveat / Inter)

## Data (Firestore)
```
admins/{uid}                                  created by hand
bars/{bar}                                    { name, instagram, hashtag, requireApproval, currentRound, roundTarget(20–30) }
bars/{bar}/notes/{id}                         { table, text, nick?, mood?, status visible|pending|hidden, reportCount, hasPhoto?, createdAt, uid }
bars/{bar}/notes/{id}/reports/{uid}
bars/{bar}/photos/{noteId}                    { data: JPEG data URL ≤900 KB }   (photos always start pending)
bars/{bar}/rounds/r{n}/strokes/{id}           { word ≤20, color joy|love|dream|calm|wild|gold, table?, createdAt, uid }
bars/{bar}/rounds/r{n}                        { status generating|done, n, words[], count, prompt, seed, source ai|abstract }
bars/{bar}/roundImages/r{n}                   { data: JPEG data URL }
bars/{bar}/banned/{uid}                       blocked devices (admin only); rules refuse their notes/photos/words/reports
rateLimits/{uid} (notes, 30 s) · strokeLimits/{uid} (words, 8 s)
```
Images live in Firestore as data URLs because Storage needs the paid Blaze plan.

## Security rules
`firestore.rules` is deployed **automatically** by `.github/workflows/deploy-rules.yml`
on push to `main` (uses repo secret `FIREBASE_SERVICE_ACCOUNT`, Firebase Rules REST API via
`.github/scripts/deploy-rules.mjs`). Rule errors show up as annotations on the Actions run.
Never ask the user to paste rules by hand.
Firebase Auth authorized domains: listed in `.github/auth-domains.txt`, added by
`.github/workflows/auth-domains.yml` (same service account, Identity Toolkit Admin API).

## AR wall gallery
- Six numbered posters: `assets/posters/afterglow-poster-N.pdf` (A3). Printed posters must
  match the PDFs exactly.
- Pictures (finished paintings + visible photo notes) are ordered by time; 1–30 → poster N° 1,
  31–60 → N° 2, … Permanent, no cycling.
- `assets/ar/ar-target-snuggest-N.mind` = first N posters, compiled with MindAR 1.2.5.
  Gallery loads the file for the posters in use. Beyond 180 pictures, posters N° 7+ must be
  designed and **all** cumulative `.mind` files recompiled (MindAR `Compiler` in headless Chromium).
- Tap handling uses a manual Three.js raycast (A-Frame's mouse cursor doesn't fire over MindAR).

## Testing
No test suite. Pages were checked in headless Chromium with an in-memory Firestore stub.
Camera/AR and real Firebase can only be verified by Özgür on his phone; say so when relevant.

## Commits
Commit straight to `main` (Pages deploys from it). Check the "Deploy Firestore rules"
Actions run after changing `firestore.rules`.

## Ideas not built yet
- Paid AI image service + Blaze/Cloud Function when selling to other venues
  (Pollinations free tier: rate-limited, may watermark, commercial use unclear).
- Multi-venue onboarding (everything is already keyed by `bars/{bar}`).
