const ALLOWED_ROLES = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner']

/**
 * POST /api/drive/list
 * Preview endpoint — lists files in a Google Drive folder without syncing.
 * Uses the current user's connected Google Drive account.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  // Auth check
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Role check
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }

  const body = await readBody(event)
  const { folderUrl } = body as { folderUrl: string }

  if (!folderUrl) {
    throw createError({ statusCode: 400, statusMessage: 'folderUrl is required' })
  }

  let folderId: string
  try {
    folderId = parseDriveFolderUrl(folderUrl)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Google Drive folder URL or ID' })
  }

  const files = await listDriveFiles(user.id, folderId, true)

  // Check which files have already been synced
  const googleFileIds = files.map(f => f.id)
  const { data: existing } = await supabase
    .from('drive_sync_files')
    .select('google_file_id')
    .in('google_file_id', googleFileIds)

  const existingIds = new Set((existing ?? []).map((e: { google_file_id: string }) => e.google_file_id))

  const fileList = files.map(f => ({
    ...f,
    alreadySynced: existingIds.has(f.id),
  }))

  return {
    folderId,
    total: files.length,
    newFiles: fileList.filter(f => !f.alreadySynced).length,
    alreadySynced: fileList.filter(f => f.alreadySynced).length,
    files: fileList,
  }
})
