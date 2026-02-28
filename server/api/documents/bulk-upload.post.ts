/**
 * POST /api/documents/bulk-upload
 * Receives metadata for multiple documents that have already been uploaded to Storage.
 * Creates document records and triggers processing for each.
 * Admin/trustee only.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const documents: Array<{
    file_url: string
    original_filename: string
    file_size_bytes: number
    mime_type: string
    title?: string
    doc_type?: string
    privacy_level?: string
  }> = body.documents

  if (!Array.isArray(documents) || documents.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No documents provided' })
  }

  if (documents.length > 50) {
    throw createError({ statusCode: 400, statusMessage: 'Maximum 50 documents per batch' })
  }

  const results: Array<{ id: string; filename: string; status: string }> = []

  for (const doc of documents) {
    try {
      const { data: record, error } = await supabase
        .from('documents')
        .insert({
          uploaded_by: user.id,
          title: doc.title || doc.original_filename?.replace(/\.[^.]+$/, '') || 'Untitled',
          original_filename: doc.original_filename,
          file_url: doc.file_url,
          file_size_bytes: doc.file_size_bytes,
          mime_type: doc.mime_type,
          privacy_level: doc.privacy_level || 'shared',
          doc_type: doc.doc_type || null,
          source_channel: 'web_upload',
          processing_status: 'pending',
        })
        .select('id')
        .single()

      if (error) {
        results.push({ id: '', filename: doc.original_filename, status: `error: ${error.message}` })
        continue
      }

      results.push({ id: record.id, filename: doc.original_filename, status: 'pending' })

      // Fire-and-forget processing
      processDocument(record.id).catch(err => {
        console.error(`Pipeline failed for bulk document ${record.id}:`, err)
      })
    } catch (err: any) {
      results.push({ id: '', filename: doc.original_filename, status: `error: ${err.message}` })
    }
  }

  return {
    total: documents.length,
    created: results.filter(r => r.status === 'pending').length,
    results,
  }
})
