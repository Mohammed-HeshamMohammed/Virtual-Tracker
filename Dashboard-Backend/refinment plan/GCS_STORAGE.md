# Virtual Tracker — Google Cloud Storage Layout

> Object storage for binary assets. Only metadata and GCS paths are stored in Firestore — never raw binary data.

---

## What uses GCS

| Asset | Previous (wrong) | Now |
|---|---|---|
| Activity screenshots | `activity_screenshots.image_data` (base64 in Firestore) | GCS object + `screenshot_url` path in Firestore |
| Profile avatars | `User_profiles.profileImageData` (base64 in Firestore) | GCS object + `photoURL` URL in Firestore |
| Task attachments | Already in GCS (correct) | No change |

---

## Bucket structure

One bucket per environment. Suggested naming:

```
vt-production       (live)
vt-staging          (staging)
vt-development      (local dev, optional)
```

All paths below are relative to the bucket root.

---

## Path conventions

### Profile avatars

```
/profile-avatars/{uid}/{timestamp}_{original_filename}
```

**Examples**:
```
/profile-avatars/abc123uid/1720000000000_photo.webp
/profile-avatars/xyz789uid/1719500000000_avatar.png
```

**Rules**:
- `{uid}` is the Firebase UID — same as the `User_profiles` document ID.
- Convert uploaded image to WebP before storing (smaller, consistent format).
- Prepend Unix timestamp so filenames are unique across re-uploads; no need to delete the old file before writing the new one.
- Store the full public URL in `User_profiles.photoURL` for fast reads without generating a signed URL on each auth verify.

**Access**: Public read (avatars are not sensitive; public URL avoids signing overhead on every page load).

**Firestore field updated**: `User_profiles.photoURL`

---

### Activity screenshots

```
/activity-screenshots/{memberId}/{sessionId}/{capturedAtUnix}.webp
```

**Examples**:
```
/activity-screenshots/member-uuid-1234/session-uuid-5678/1720000100000.webp
/activity-screenshots/member-uuid-1234/session-uuid-5678/1720000200000.webp
```

**Rules**:
- `{capturedAtUnix}` is `captured_at` as Unix ms timestamp — guarantees uniqueness within a session and sorts chronologically.
- Convert to WebP before storing. Target <80 KB per thumbnail (resize to 1280×720 max before upload).
- **Do not store the full signed URL in Firestore** — store only the GCS object path (without bucket name). Generate a signed URL at read time in the API layer.
- Screenshots may be deleted after a retention period (e.g. 90 days). Use GCS lifecycle rules for automatic cleanup.

**Access**: Private. Generate a signed URL with a short expiry (15 minutes) when the client requests the activity feed.

**Firestore field stored**: `activity_screenshots.screenshot_url` — stores the object path only:
```
activity-screenshots/member-uuid-1234/session-uuid-5678/1720000100000.webp
```

---

### Task attachments

Already correctly using GCS. No changes needed. Documented here for completeness.

```
/task-attachments/{taskId}/{attachmentId}_{original_filename}
```

**Examples**:
```
/task-attachments/task-uuid-9012/attach-uuid-3456_design-spec.pdf
/task-attachments/task-uuid-9012/attach-uuid-7890_screenshot.png
```

**Rules**:
- Prefix the `attachmentId` to guarantee uniqueness for filenames that repeat across tasks.
- Preserve the original filename suffix so users see the real name when downloading.
- Store the full GCS path in `tasks/{taskId}/attachments[].file_url`.

**Access**: Private. Generate a signed URL (1 hour expiry) when the client requests the task detail.

---

## Backend implementation

### Upload helper

```js
// src/lib/gcs/upload.js
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket  = storage.bucket(process.env.GCS_BUCKET_NAME);

/**
 * Upload a buffer to GCS and return the object path.
 * @param {Buffer} buffer
 * @param {string} objectPath  - e.g. 'profile-avatars/uid123/1720000000_avatar.webp'
 * @param {string} contentType - e.g. 'image/webp'
 * @param {boolean} isPublic   - true for avatars, false for screenshots/attachments
 * @returns {string} objectPath
 */
export async function uploadToGCS(buffer, objectPath, contentType, isPublic = false) {
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    metadata: { contentType },
    resumable: false,
  });
  if (isPublic) {
    await file.makePublic();
  }
  return objectPath;
}

/**
 * Generate a signed URL for private objects.
 * @param {string} objectPath
 * @param {number} expiresInMinutes
 * @returns {string} signed URL
 */
export async function getSignedUrl(objectPath, expiresInMinutes = 15) {
  const [url] = await bucket.file(objectPath).getSignedUrl({
    action:  'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}

/**
 * Get the public URL for public objects (avatars).
 * @param {string} objectPath
 * @returns {string} public URL
 */
export function getPublicUrl(objectPath) {
  return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${objectPath}`;
}
```

---

### Avatar upload flow

```js
// In: src/modules/auth/routes.js — PATCH /api/auth/avatar
import sharp from 'sharp';
import { uploadToGCS, getPublicUrl } from '../../lib/gcs/upload.js';

async function handleAvatarUpload(req, res) {
  const { uid }         = req.member;          // from auth middleware
  const { imageBase64, mimeType } = req.body;

  // Convert to WebP and resize
  const buffer = Buffer.from(imageBase64, 'base64');
  const webp   = await sharp(buffer)
    .resize({ width: 256, height: 256, fit: 'cover' })
    .webp({ quality: 85 })
    .toBuffer();

  const objectPath = `profile-avatars/${uid}/${Date.now()}_avatar.webp`;
  await uploadToGCS(webp, objectPath, 'image/webp', true);  // isPublic = true
  const photoURL = getPublicUrl(objectPath);

  // Update User_profiles — no more base64 fields
  await db.collection('User_profiles').doc(uid).update({ photoURL, updatedAt: new Date() });

  return res.json({ photoURL });
}
```

---

### Screenshot upload flow

```js
// In: src/modules/activity/routes.js — POST /api/activity/events
import sharp from 'sharp';
import { uploadToGCS } from '../../lib/gcs/upload.js';

async function handleActivityEvents(req, res) {
  const { memberId, sessionId } = req;           // from middleware
  const { screenshots = [], appLogs = [], urlLogs = [] } = req.body;

  const screenshotWrites = screenshots.map(async (s) => {
    // Convert and resize screenshot
    const buffer     = Buffer.from(s.image_data, 'base64');
    const webp       = await sharp(buffer)
      .resize({ width: 1280, height: 720, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    const capturedMs = new Date(s.captured_at).getTime();
    const objectPath = `activity-screenshots/${memberId}/${sessionId}/${capturedMs}.webp`;
    await uploadToGCS(webp, objectPath, 'image/webp', false);  // private

    return {
      id:             generateUUID(),
      member_id:      memberId,
      session_id:     sessionId,
      screenshot_url: objectPath,           // store path, not signed URL
      app_name:       s.app_name,
      page_title:     s.page_title,
      activity_level: s.activity_level,
      captured_at:    new Date(s.captured_at),
    };
  });

  const screenshotDocs = await Promise.all(screenshotWrites);

  // Batch write to Firestore — no image_data field
  const batch = db.batch();
  screenshotDocs.forEach(doc => {
    batch.set(db.collection('activity_screenshots').doc(doc.id), doc);
  });
  // ... also handle appLogs, urlLogs in same batch
  await batch.commit();

  return res.json({ ok: true });
}
```

---

### Signed URL generation on feed read

```js
// In: src/modules/activity/routes.js — GET /api/activity/feed
import { getSignedUrl } from '../../lib/gcs/upload.js';

async function handleActivityFeed(req, res) {
  const { memberId, from, to } = req.query;

  const snap = await db.collection('activity_screenshots')
    .where('member_id', '==', memberId)
    .where('captured_at', '>=', new Date(from))
    .where('captured_at', '<=', new Date(to))
    .orderBy('captured_at', 'desc')
    .limit(100)
    .get();

  // Generate signed URLs in parallel — 15 min expiry
  const screenshots = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data();
      const signedUrl = await getSignedUrl(data.screenshot_url, 15);
      return { ...data, screenshot_url: signedUrl };
    })
  );

  return res.json({ screenshots });
}
```

---

## GCS bucket settings (Firebase Console / gcloud)

### CORS (required for direct client uploads of task attachments)

```json
[
  {
    "origin": ["https://myvirtualtracker.com", "https://dashboard.myvirtualtracker.com"],
    "method": ["GET", "PUT", "POST"],
    "responseHeader": ["Content-Type", "Authorization"],
    "maxAgeSeconds": 3600
  }
]
```

Apply with:
```bash
gsutil cors set cors.json gs://vt-production
```

### Lifecycle rule — auto-delete old screenshots

```json
[
  {
    "action": { "type": "Delete" },
    "condition": {
      "age": 90,
      "matchesPrefix": ["activity-screenshots/"]
    }
  }
]
```

Apply with:
```bash
gsutil lifecycle set lifecycle.json gs://vt-production
```

### IAM — service account for Dashboard-Backend

The service account used by Firebase Admin SDK already has Storage Object Admin by default when using the Firebase default bucket. If using a separate bucket:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:firebase-adminsdk@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

---

## Environment variables

```
GCS_BUCKET_NAME=vt-production
# FIREBASE_SERVICE_ACCOUNT already covers GCS auth when using Firebase Admin SDK
```

---

## Summary

| Asset | GCS path | Access | Firestore field |
|---|---|---|---|
| Profile avatar | `/profile-avatars/{uid}/{ts}_avatar.webp` | Public URL | `User_profiles.photoURL` |
| Activity screenshot | `/activity-screenshots/{memberId}/{sessionId}/{ts}.webp` | Signed URL (15 min) | `activity_screenshots.screenshot_url` |
| Task attachment | `/task-attachments/{taskId}/{attachId}_{filename}` | Signed URL (60 min) | `tasks/{taskId}/attachments[].file_url` |
