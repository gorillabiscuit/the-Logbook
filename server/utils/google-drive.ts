import { google, type drive_v3 } from 'googleapis'

interface DriveFile {
  id: string
  name: string
  mimeType: string
  size: number
  modifiedTime: string
}

// Google Workspace MIME types that need to be exported (not downloaded directly)
const EXPORT_MIME_MAP: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
}

// MIME types we skip (not exportable / not useful as documents)
const SKIP_MIME_TYPES = new Set([
  'application/vnd.google-apps.folder',
  'application/vnd.google-apps.form',
  'application/vnd.google-apps.map',
  'application/vnd.google-apps.site',
  'application/vnd.google-apps.script',
  'application/vnd.google-apps.shortcut',
])

/**
 * Creates an authenticated Google Drive client for a specific user.
 * Looks up tokens from google_tokens table and handles auto-refresh.
 */
export async function getGoogleDriveClientForUser(userId: string): Promise<drive_v3.Drive> {
  const config = useRuntimeConfig()
  const { googleClientId, googleClientSecret } = config
  const supabase = useSupabaseAdmin()

  if (!googleClientId || !googleClientSecret) {
    throw new Error('Google Drive app credentials not configured. Set NUXT_GOOGLE_CLIENT_ID and NUXT_GOOGLE_CLIENT_SECRET.')
  }

  // Look up user's tokens
  const { data: tokenRow, error } = await supabase
    .from('google_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', userId)
    .single()

  if (error || !tokenRow) {
    throw new Error('Google Drive not connected. Please connect your Google account first.')
  }

  const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
  )

  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : undefined,
  })

  // Auto-persist refreshed tokens
  oauth2Client.on('tokens', async (tokens) => {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (tokens.access_token) updates.access_token = tokens.access_token
    if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token
    if (tokens.expiry_date) updates.token_expiry = new Date(tokens.expiry_date).toISOString()

    await supabase
      .from('google_tokens')
      .update(updates)
      .eq('user_id', userId)
  })

  // Force a token refresh if expired or about to expire
  const now = Date.now()
  const expiry = tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : 0
  if (expiry && expiry - now < 60_000) {
    try {
      await oauth2Client.getAccessToken()
    } catch (err: any) {
      // Token refresh failed — user likely revoked access on Google side
      await supabase.from('google_tokens').delete().eq('user_id', userId)
      throw new Error('Google Drive access was revoked. Please reconnect your Google account.')
    }
  }

  return google.drive({ version: 'v3', auth: oauth2Client })
}

/**
 * Lists all files in a Google Drive folder (optionally recursive).
 * Skips folders and non-downloadable Google Workspace types.
 */
export async function listDriveFiles(userId: string, folderId: string, recursive = true): Promise<DriveFile[]> {
  const drive = await getGoogleDriveClientForUser(userId)
  const files: DriveFile[] = []

  async function listFolder(currentFolderId: string) {
    let pageToken: string | undefined

    do {
      const res = await drive.files.list({
        q: `'${currentFolderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
        pageSize: 1000,
        pageToken,
      })

      for (const file of res.data.files ?? []) {
        if (!file.id || !file.name || !file.mimeType) continue

        // Recurse into subfolders
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          if (recursive) {
            await listFolder(file.id)
          }
          continue
        }

        // Skip non-exportable types
        if (SKIP_MIME_TYPES.has(file.mimeType)) continue

        files.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: parseInt(file.size ?? '0', 10),
          modifiedTime: file.modifiedTime ?? new Date().toISOString(),
        })
      }

      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  await listFolder(folderId)
  return files
}

/**
 * Downloads a file from Google Drive as a Buffer.
 * Google Workspace files (Docs, Sheets, Slides) are exported as PDF.
 */
export async function downloadDriveFile(userId: string, fileId: string, mimeType: string): Promise<{ buffer: Buffer; exportedMimeType: string }> {
  const drive = await getGoogleDriveClientForUser(userId)

  const exportMime = EXPORT_MIME_MAP[mimeType]

  if (exportMime) {
    // Google Workspace file — export as PDF
    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: 'arraybuffer' },
    )
    return {
      buffer: Buffer.from(res.data as ArrayBuffer),
      exportedMimeType: exportMime,
    }
  }

  // Regular file — download directly
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  )
  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    exportedMimeType: mimeType,
  }
}

/**
 * Extracts a folder ID from a Google Drive folder URL.
 * Supports formats:
 *   - https://drive.google.com/drive/folders/FOLDER_ID
 *   - https://drive.google.com/drive/u/0/folders/FOLDER_ID
 *   - https://drive.google.com/open?id=FOLDER_ID
 *   - https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
 *   - Raw folder ID string
 */
export function parseDriveFolderUrl(input: string): string {
  const trimmed = input.trim()

  // Match /folders/FOLDER_ID pattern
  const foldersMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (foldersMatch) return foldersMatch[1]!

  // Match ?id=FOLDER_ID query parameter (e.g. /open?id=... or /file/d/...?id=...)
  try {
    const url = new URL(trimmed)
    const idParam = url.searchParams.get('id')
    if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) {
      return idParam
    }
  } catch {
    // Not a valid URL — fall through to raw ID check
  }

  // If it looks like a raw ID (no slashes, reasonable length), use as-is
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed) && trimmed.length > 10) {
    return trimmed
  }

  throw new Error('Invalid Google Drive folder URL or ID')
}
