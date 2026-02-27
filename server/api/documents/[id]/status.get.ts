/**
 * GET /api/documents/:id/status
 * Returns the current processing status of a document for polling.
 */
export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'id')
  if (!documentId) {
    throw createError({ statusCode: 400, statusMessage: 'Document ID required' })
  }

  const supabase = useSupabaseAdmin()

  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, processing_status, processing_error, ai_summary, ai_confidence, processed_at')
    .eq('id', documentId)
    .single()

  if (error || !doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  // Also fetch processing log stages
  const { data: stages } = await supabase
    .from('processing_log')
    .select('stage, status, error_message, started_at, completed_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true })

  return {
    documentId: doc.id,
    status: doc.processing_status,
    error: doc.processing_error,
    summary: doc.ai_summary,
    confidence: doc.ai_confidence,
    processedAt: doc.processed_at,
    stages: stages ?? [],
  }
})
