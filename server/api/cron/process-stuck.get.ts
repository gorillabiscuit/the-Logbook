/**
 * GET /api/cron/process-stuck
 * Finds documents stuck in "processing" or "pending" and retries or marks failed.
 *
 * Secured via CRON_SECRET / Authorization: Bearer header.
 * Vercel sends this automatically for cron jobs.
 */
export default defineEventHandler(async (event) => {
  // Verify cron secret
  const config = useRuntimeConfig()
  const cronSecret = config.cronSecret

  if (!cronSecret) {
    throw createError({ statusCode: 500, statusMessage: 'CRON_SECRET not configured' })
  }

  const authHeader = getHeader(event, 'authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = useSupabaseAdmin()
  const maxRetries = 3

  // Find stuck documents via RPC
  const { data: stuckDocs, error } = await supabase.rpc('find_stuck_documents', {
    max_retries: maxRetries,
    processing_threshold: '10 minutes',
    pending_threshold: '5 minutes',
  })

  if (error) {
    console.error('Failed to find stuck documents:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to query stuck documents' })
  }

  if (!stuckDocs || stuckDocs.length === 0) {
    return { processed: 0, retried: [], failed: [] }
  }

  const retried: string[] = []
  const failed: string[] = []

  for (const doc of stuckDocs) {
    if (doc.retry_count < maxRetries) {
      // Retry: clear processing data and restart pipeline
      await supabase.from('processing_log').delete().eq('document_id', doc.document_id)
      await supabase.from('chunks').delete().eq('document_id', doc.document_id)

      await supabase
        .from('documents')
        .update({
          processing_status: 'pending',
          processing_error: null,
          extracted_text: null,
          scrubbed_text: null,
          scrubbed_text_light: null,
          scrubbed_text_heavy: null,
          ai_summary: null,
          ai_confidence: null,
          processed_at: null,
          retry_count: doc.retry_count + 1,
        })
        .eq('id', doc.document_id)

      // Fire-and-forget processing
      const processingPromise = processDocument(doc.document_id).catch((err) => {
        console.error(`Stuck recovery pipeline failed for ${doc.document_id}:`, err)
      })

      if (typeof (event as any).waitUntil === 'function') {
        ;(event as any).waitUntil(processingPromise)
      } else {
        processingPromise.catch(() => {})
      }

      retried.push(doc.document_id)
    } else {
      // Max retries exceeded — mark as failed
      await supabase
        .from('documents')
        .update({
          processing_status: 'failed',
          processing_error: `Automatically marked as failed after ${maxRetries} retry attempts. The document may be too large or in an unsupported format.`,
        })
        .eq('id', doc.document_id)

      failed.push(doc.document_id)
    }
  }

  console.log(`Stuck doc recovery: ${retried.length} retried, ${failed.length} failed`)

  return {
    processed: stuckDocs.length,
    retried,
    failed,
  }
})
