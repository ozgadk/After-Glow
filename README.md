# Afterglow

Leave a trace where you sat. Guests scan a QR code on their table, read notes
left by strangers who sat there before, and leave one for whoever comes next.
No app download, no sign-up.

**Phase 1 (this version):** table notes  
Includes photos: resized on the phone, given the warm "Afterglow" tone, EXIF/GPS stripped,
checked on-device for nudity (nsfw.js), stored in `bars/{barId}/photos/{noteId}` and always
held for admin approval.

**Phase 2:** Living Painting in rounds. Guests pick a mood colour and send one word;
on the bar screen each word becomes glowing brush strokes. When a round reaches its
target (20–30 words, set in admin), the host screen builds a prompt from the words and
moods, generates an image (Pollinations, free tier; falls back to the abstract painting
if that fails), reveals it, and opens the next round. Every participant's phone then
shows a keepsake: the image plus all words with theirs highlighted, saved as a
1080×1920 postcard.

Rounds close automatically only on a screen where an admin is signed in
(`screen.html`), or manually from the admin panel.

Data: `bars/{barId}` `{currentRound, roundTarget}` ·
`bars/{barId}/rounds/r{n}/strokes/*` · `bars/{barId}/rounds/r{n}` (words, prompt,
status) · `bars/{barId}/roundImages/r{n}` (JPEG).

**Phase 3:** AR wall gallery (`gallery.html`). Six numbered posters
(`assets/posters/afterglow-poster-N.pdf`, A3). Every finished painting and approved
photo gets a permanent place in time order: pictures 1–30 hang around poster N° 1,
31–60 around N° 2, and so on. Pointing the phone at a poster shows its pictures as
polaroids (with the note text) on the wall around it; tap to enlarge. Images load
only for the poster in view. `assets/ar/ar-target-snuggest-N.mind` holds the first N
posters (compiled with MindAR 1.2.5), so phones download only what's in use. The
admin panel shows how full each poster is and when to print the next one. Beyond 180
pictures, new posters (N° 7+) need to be designed and compiled.

Any printed poster must match its PDF exactly (no cropping or colour changes).

## Pages

| URL | What |
|---|---|
| `index.html?bar=snuggest&t=5` | Guest page for table 5 (this is what the QR code opens) |
| `admin.html?bar=snuggest` | Moderation: notes, tonight's painting words, saved paintings |
| `screen.html?bar=snuggest` | Living Painting for the bar TV (tap once → fullscreen, screen stays awake) |
| `gallery.html?bar=snuggest` | Wall gallery: AR on the poster, or plain browsing |
| `index.html?bar=snuggest&paint=1` | Painting-only page (QR on the bar screen) |

## Stack

Static site on GitHub Pages · Firebase Auth (anonymous for guests, Google for
admins) · Cloud Firestore. Languages: EN / LV / RU / TR.

## Data

```
bars/{barId}                     { name, requireApproval }
bars/{barId}/notes/{noteId}      { table, text, nick?, mood?, status, reportCount, createdAt, uid }
bars/{barId}/notes/{id}/reports/{uid}
rateLimits/{uid}                 { last }   // max 1 note per 30 s per device
admins/{uid}                     // created by hand in the console
```

`status` is `visible`, `pending` (approval mode) or `hidden`. Notes with 3+
reports are hidden from guests until an admin reviews them.

## One-time Firebase setup

1. **Authentication → Sign-in method:** enable **Anonymous** and **Google**.
2. **Authentication → Settings → Authorized domains:** add `ozgadk.github.io`.
3. **Firestore → Rules:** paste `firestore.rules`, Publish.
4. Open `admin.html`, sign in with Google, copy the UID shown, then in
   **Firestore → Data** create collection `admins` → document with that UID as
   the ID (any field, e.g. `name`).

## Notes

- Photos are stored in Firestore (free Spark plan) instead of Storage, which needs Blaze.
  Move to Storage + Cloud Vision SafeSearch when going multi-venue.
- The word filter is client-side and can be bypassed; reports + the admin panel
  (and approval mode) are the real safety net.

## Automatic rules deploy

`.github/workflows/deploy-rules.yml` publishes `firestore.rules` on every push to
`main`. It needs one repo secret, `FIREBASE_SERVICE_ACCOUNT` (the JSON key from
Firebase → Project settings → Service accounts → Generate new private key).
Without the secret the workflow just skips.
