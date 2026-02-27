/**
 * POST /api/documents/:id/reprocess
 * Admin-only endpoint to reprocess a document (retry the full pipeline).
 */
export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'id')
  if (!documentId) {
    throw createError({ statusCode: 400, statusMessage: 'Document ID required' })
  }

  const supabase = useSupabaseAdmin()

  // Verify caller is an admin
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { data: { user } } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  // Verify document exists
  const { data: doc } = await supabase
    .from('documents')
    .select('id')
    .eq('id', documentId)
    .single()

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  // Clear existing processing data
  await supabase.from('processing_log').delete().eq('document_id', documentId)
  await supabase.from('chunks').delete().eq('document_id', documentId)

  // Reset document fields
  await supabase
    .from('documents')
    .update({
      processing_status: 'pending',
      processing_error: null,
      extracted_text: null,
      scrubbed_text: null,
      ai_summary: null,
      ai_confidence: null,
      processed_at: null,
    })
    .eq('id', documentId)

  // Fire-and-forget processing
  const processingPromise = processDocument(documentId).catch((err) => {
    console.error(`Reprocess pipeline failed for document ${documentId}:`, err)
  })

  if (typeof (event as any).waitUntil === 'function') {
    ;(event as any).waitUntil(processingPromise)
  } else {
    processingPromise.catch(() => {})
  }

  return { status: 'processing', documentId }
})
