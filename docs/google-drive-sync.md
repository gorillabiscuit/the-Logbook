# Google Drive Folder Sync — Implementation Plan

## Context

The user has a Google Drive folder full of historical building documents that need to be imported into The Logbook. Currently, the only way to get them in is manually downloading and re-uploading via the web interface or bulk upload page. This feature allows an admin to connect their Google account, point at a Drive folder, and automatically sync all files (including subfolders) into the platform — running each through the full AI processing pipeline.

---

## Packages to Install

```bash
pnpm add googleapis
```

`googleapis` includes both the Google Drive API client and the OAuth2 client — no separate auth package needed.

---

## Implementation Steps

### Step 1: Database Migration + Config

**New migration** `supabase/migrations/003_google_drive_sync.sql`:
- `drive_sync_files` table — tracks which Google Drive files have been imported (avoids duplicates on re-sync)
  - `id`, `google_file_id` (unique), `document_id` (FK), `google_folder_id`, `synced_by` (FK to profiles), `synced_at`

No OAuth token table needed — we store the refresh token in `.env` since this is a single-admin feature at the ~180 unit scale. No need for multi-user OAuth.

**Update `nuxt.config.ts`** runtimeConfig:
- `googleClientId`, `googleClientSecret`, `googleRefreshToken`

**Update `.env`**:
- `NUXT_GOOGLE_CLIENT_ID`, `NUXT_GOOGLE_CLIENT_SECRET`, `NUXT_GOOGLE_REFRESH_TOKEN`

### Step 2: Google Drive Utility

**Create `server/utils/google-drive.ts`**:
- `getGoogleDriveClient()` — creates authenticated Drive client using OAuth2 with refresh token
- `listFilesInFolder(folderId, recursive?)` — lists all files in a folder (and subfolders), returns array of `{ id, name, mimeType, size, modifiedTime }`
- `downloadFile(fileId)` — downloads file content as Buffer
- Handles Google Workspace files (Docs/Sheets) by exporting as PDF

### Step 3: Sync API Endpoints

**Create `server/api/admin/drive/sync.post.ts`**:
- Accepts `{ folderId: string, privacyLevel?: string }`
- Admin only (super_admin/trustee)
- Calls `listFilesInFolder(folderId, true)` to get all files
- Filters out already-synced files (checks `drive_sync_files` table)
- For each new file: download → upload to Supabase Storage → create document record → fire-and-forget `processDocument()`
- Returns `{ total, new, skipped, results[] }`

**Create `server/api/admin/drive/list.post.ts`**:
- Preview endpoint — lists files in a folder without syncing
- Returns file list so user can see what will be imported before committing

**Create `server/api/admin/drive/status.get.ts`**:
- Returns sync history and stats (how many files synced, last sync date)

### Step 4: Frontend Page

**Create `app/pages/admin/drive.vue`**:
- Input field for Google Drive folder URL or ID
- "Preview" button → shows file count and list
- Privacy level selector (default for all imported files)
- "Sync now" button → triggers import
- Progress/results display
- Sync history table (previous syncs with counts)

**Update `app/layouts/default.vue`**:
- Add "Drive Sync" link to admin sidebar

### Step 5: Source Channel

**Update `documents.source_channel`** check constraint to include `'google_drive'` — needs a migration ALTER.

---

## Key Decisions

- **Single refresh token in .env** (not per-user OAuth): This is an admin tool for ~180 units. The admin connects their Google account once, stores the refresh token. No need for a full OAuth flow with callback URLs and per-user token storage. The admin can generate the refresh token via Google's OAuth Playground or a one-time setup script.
- **Recursive subfolder sync**: All files in the folder tree get imported. Subfolder names are not used for categorization — the AI pipeline handles that.
- **Deduplication by Google file ID**: The `drive_sync_files` table tracks which files have been synced. Re-running sync on the same folder only imports new/unsynced files.
- **Privacy level set per-sync**: All files in a batch get the same privacy level (configurable, defaults to 'shared').
- **Fire-and-forget processing**: Same pattern as web uploads — document record created immediately, AI pipeline runs in background.
- **Google Workspace files** (Docs, Sheets, Slides): Exported as PDF before importing.

---

## Files Summary

**New files (5):**
- `supabase/migrations/003_google_drive_sync.sql`
- `server/utils/google-drive.ts`
- `server/api/admin/drive/sync.post.ts`
- `server/api/admin/drive/list.post.ts`
- `app/pages/admin/drive.vue`

**Modified files (3):**
- `nuxt.config.ts` — add Google runtimeConfig keys
- `.env` — add Google credentials
- `app/layouts/default.vue` — add Drive Sync to admin sidebar

---

## Setup for the User

To get the Google refresh token:
1. Go to https://console.cloud.google.com → create project → enable Google Drive API
2. Create OAuth2 credentials (Desktop app type)
3. Use Google's OAuth Playground (https://developers.google.com/oauthplayground) to authorize with `drive.readonly` scope
4. Exchange the authorization code for a refresh token
5. Add credentials to `.env`

---

## Verification

1. Add Google credentials to `.env`
2. Navigate to `/admin/drive`
3. Paste a Google Drive folder URL
4. Click "Preview" → see list of files
5. Click "Sync" → files download and appear in Documents
6. Each synced doc runs through the AI pipeline (categorization, PII scrub, embeddings, entity extraction)
7. Re-clicking "Sync" on the same folder → shows "0 new files" (deduplication works)
