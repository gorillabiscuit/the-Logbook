const ALLOWED_ROLES = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner']
const PRIVILEGED_ROLES = ['super_admin', 'trustee', 'lawyer']

/**
 * POST /api/drive/sync-file
 * Syncs a SINGLE file from Google Drive into the platform.
 * Downloads the file -> uploads to Supabase Storage -> creates document record -> triggers processing.
 *
 * Request body: { googleFileId, fileName, mimeType, folderId, privacyLevel }
 * Always returns 200 for file-level results. HTTP errors only for auth/validation failures.
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
  const { googleFileId, fileName, mimeType, folderId, privacyLevel = 'shared' } = body as {
    googleFileId: string
    fileName: string
    mimeType: string
    folderId: string
    privacyLevel?: string
  }

  if (!googleFileId || !fileName || !mimeType || !folderId) {
    throw createError({ statusCode: 400, statusMessage: 'googleFileId, fileName, mimeType, and folderId are required' })
  }

  if (!['shared', 'private', 'privileged'].includes(privacyLevel)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid privacy level' })
  }

  if (privacyLevel === 'privileged' && !PRIVILEGED_ROLES.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only admins and lawyers can set privileged privacy level' })
  }

  // Check if already synced (dedup)
  const { data: existingSync } = await supabase
    .from('drive_sync_files')
    .select('google_file_id')
    .eq('google_file_id', googleFileId)
    .maybeSingle()

  if (existingSync) {
    return {
      googleFileId,
      filename: fileName,
      documentId: null,
      status: 'already_synced',
    }
  }

  try {
    // Download from Drive using user's credentials
    const { buffer, exportedMimeType } = await downloadDriveFile(user.id, googleFileId, mimeType)

    // Determine filename (append .pdf if exported from Workspace)
    let filename = fileName
    if (exportedMimeType !== mimeType && !filename.toLowerCase().endsWith('.pdf')) {
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
      return {
        googleFileId,
        filename: fileName,
        documentId: null,
        status: 'error',
        error: `Storage upload failed: ${uploadError.message}`,
      }
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
      return {
        googleFileId,
        filename: fileName,
        documentId: null,
        status: 'error',
        error: `Document insert failed: ${insertError?.message}`,
      }
    }

    // Record sync mapping (catch unique violation for race condition safety)
    const { error: syncInsertError } = await supabase.from('drive_sync_files').insert({
      google_file_id: googleFileId,
      document_id: doc.id,
      google_folder_id: folderId,
      synced_by: user.id,
    })

    if (syncInsertError?.code === '23505') {
      // Unique violation — already synced by another request
      return {
        googleFileId,
        filename: fileName,
        documentId: doc.id,
        status: 'already_synced',
      }
    }

    // Use waitUntil to keep the function alive on Vercel while processing runs
    const processingPromise = processDocument(doc.id).catch(err => {
      console.error(`Pipeline failed for Drive file ${fileName} (${doc.id}):`, err)
    })
    if (typeof (event as any).waitUntil === 'function') {
      ;(event as any).waitUntil(processingPromise)
    }

    return {
      googleFileId,
      filename: fileName,
      documentId: doc.id,
      status: 'imported',
    }
  } catch (err: any) {
    return {
      googleFileId,
      filename: fileName,
      documentId: null,
      status: 'error',
      error: err.message,
    }
  }
})
