/**
 * POST /api/documents/:id/process
 * Triggers the document processing pipeline (fire-and-forget).
 * The processing runs in the background via waitUntil.
 */
export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'id')
  if (!documentId) {
    throw createError({ statusCode: 400, statusMessage: 'Document ID required' })
  }

  const supabase = useSupabaseAdmin()

  // Verify document exists and is in a processable state
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, processing_status')
    .eq('id', documentId)
    .single()

  if (error || !doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  if (doc.processing_status === 'processing') {
    throw createError({ statusCode: 409, statusMessage: 'Document is already being processed' })
  }

  // Fire-and-forget: start processing in the background
  // Use waitUntil if available (Vercel/Cloudflare), otherwise just run async
  const processingPromise = processDocument(documentId).catch((err) => {
    console.error(`Pipeline failed for document ${documentId}:`, err)
  })

  if (typeof (event as any).waitUntil === 'function') {
    ;(event as any).waitUntil(processingPromise)
  } else {
    // In dev mode or environments without waitUntil, just let it run
    processingPromise.catch(() => {})
  }

  return { status: 'processing', documentId }
})
