const ALLOWED_ROLES = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner']
const PRIVILEGED_ROLES = ['super_admin', 'trustee', 'lawyer']

/**
 * POST /api/drive/sync
 * Syncs files from a Google Drive folder into the platform.
 * Downloads each new file -> uploads to Supabase Storage -> creates document record -> triggers processing.
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
  const { folderUrl, privacyLevel = 'shared' } = body as {
    folderUrl: string
    privacyLevel?: string
  }

  if (!folderUrl) {
    throw createError({ statusCode: 400, statusMessage: 'folderUrl is required' })
  }

  if (!['shared', 'private', 'privileged'].includes(privacyLevel)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid privacy level' })
  }

  // Non-privileged roles cannot set privileged privacy level
  if (privacyLevel === 'privileged' && !PRIVILEGED_ROLES.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only admins and lawyers can set privileged privacy level' })
  }

  let folderId: string
  try {
    folderId = parseDriveFolderUrl(folderUrl)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Google Drive folder URL or ID' })
  }

  // List all files in the folder using user's Drive
  const files = await listDriveFiles(user.id, folderId, true)

  // Find already-synced files
  const googleFileIds = files.map(f => f.id)
  const { data: existing } = await supabase
    .from('drive_sync_files')
    .select('google_file_id')
    .in('google_file_id', googleFileIds)

  const existingIds = new Set((existing ?? []).map((e: { google_file_id: string }) => e.google_file_id))
  const newFiles = files.filter(f => !existingIds.has(f.id))

  const results: Array<{
    googleFileId: string
    filename: string
    documentId: string | null
    status: string
    error?: string
  }> = []
  const processingPromises: Promise<void>[] = []

  // Process each new file
  for (const file of newFiles) {
    try {
      // Download from Drive using user's credentials
      const { buffer, exportedMimeType } = await downloadDriveFile(user.id, file.id, file.mimeType)

      // Determine filename (append .pdf if exported from Workspace)
      let filename = file.name
      if (exportedMimeType !== file.mimeType && !filename.toLowerCase().endsWith('.pdf')) {
        filename += '.pdf'
      }

      // Upload to Supabase Storage
      const storagePath = `uploads/${user.id}/${Date.now()}-${filename}`
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, buffer, {
          contentType: exportedMimeType,
          upsert: false,
        })

      if (uploadError) {
        results.push({
          googleFileId: file.id,
          filename: file.name,
          documentId: null,
          status: 'error',
          error: `Storage upload failed: ${uploadError.message}`,
        })
        continue
      }

      // Create document record
      const title = filename.replace(/\.[^.]+$/, '')
      const { data: doc, error: insertError } = await supabase
        .from('documents')
        .insert({
          uploaded_by: user.id,
          title,
          original_filename: filename,
          file_url: storagePath,
          file_size_bytes: buffer.length,
          mime_type: exportedMimeType,
          privacy_level: privacyLevel,
          source_channel: 'google_drive',
          processing_status: 'pending',
        })
        .select('id')
        .single()

      if (insertError || !doc) {
        results.push({
          googleFileId: file.id,
          filename: file.name,
          documentId: null,
          status: 'error',
          error: `Document insert failed: ${insertError?.message}`,
        })
        continue
      }

      // Record sync mapping
      await supabase.from('drive_sync_files').insert({
        google_file_id: file.id,
        document_id: doc.id,
        google_folder_id: folderId,
        synced_by: user.id,
      })

      results.push({
        googleFileId: file.id,
        filename: file.name,
        documentId: doc.id,
        status: 'pending',
      })

      processingPromises.push(
        processDocument(doc.id).catch(err => {
          console.error(`Pipeline failed for Drive file ${file.name} (${doc.id}):`, err)
        })
      )
    } catch (err: any) {
      results.push({
        googleFileId: file.id,
        filename: file.name,
        documentId: null,
        status: 'error',
        error: err.message,
      })
    }
  }

  // Use waitUntil to keep the function alive on Vercel while processing runs
  if (processingPromises.length > 0) {
    const allProcessing = Promise.all(processingPromises)
    if (typeof (event as any).waitUntil === 'function') {
      ;(event as any).waitUntil(allProcessing)
    }
  }

  return {
    folderId,
    total: files.length,
    newFiles: newFiles.length,
    skipped: existingIds.size,
    imported: results.filter(r => r.status === 'pending').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  }
})
