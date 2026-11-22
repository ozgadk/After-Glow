# Afterglow

Leave a trace where you sat. Guests scan a QR code on their table, read notes
left by strangers who sat there before, and leave one for whoever comes next.
No app download, no sign-up.

**Phase 1 (this version):** table notes  
Includes photos: resized on the phone, given the warm "Afterglow" tone, EXIF/GPS stripped,
checked on-device for nudity (nsfw.js), stored in `bars/{barId}/photos/{noteId}` and always
held for admin approval.

Next: Living Painting (AI-generated shared artwork on the bar screen), AR wall gallery.

## Pages

| URL | What |
|---|---|
| `index.html?bar=snuggest&t=5` | Guest page for table 5 (this is what the QR code opens) |
| `admin.html?bar=snuggest` | Moderation: approve / hide / delete notes, approval mode |

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
