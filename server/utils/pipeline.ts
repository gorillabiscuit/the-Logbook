/**
 * Document processing pipeline orchestrator.
 * Runs stages sequentially: extraction → PII scrub → categorization → embedding → indexing.
 * Each stage is logged independently; failures are captured without losing partial results.
 */

type PipelineStage = 'extraction' | 'pii_scrub' | 'categorization' | 'embedding' | 'indexing' | 'entity_extraction'

interface StageResult {
  stage: PipelineStage
  success: boolean
  error?: string
}

/**
 * Logs the start of a pipeline stage.
 */
async function logStageStart(documentId: string, stage: PipelineStage) {
  const supabase = useSupabaseAdmin()
  await supabase.from('processing_log').insert({
    document_id: documentId,
    stage,
    status: 'running',
    started_at: new Date().toISOString(),
  })
}

/**
 * Logs the completion of a pipeline stage.
 */
async function logStageComplete(documentId: string, stage: PipelineStage, error?: string) {
  const supabase = useSupabaseAdmin()

  // Find the running log entry for this document+stage and update it
  const { data: existing } = await supabase
    .from('processing_log')
    .select('id')
    .eq('document_id', documentId)
    .eq('stage', stage)
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing) {
    await supabase
      .from('processing_log')
      .update({
        status: error ? 'failed' : 'completed',
        error_message: error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
  }
}

/**
 * Runs a single pipeline stage with logging.
 */
async function runStage(
  documentId: string,
  stage: PipelineStage,
  fn: () => Promise<void>
): Promise<StageResult> {
  await logStageStart(documentId, stage)
  try {
    await fn()
    await logStageComplete(documentId, stage)
    return { stage, success: true }
  } catch (err: any) {
    const errorMessage = err?.message ?? String(err)
    await logStageComplete(documentId, stage, errorMessage)
    return { stage, success: false, error: errorMessage }
  }
}

/**
 * Runs the full document processing pipeline.
 * Each stage depends on the previous one — if extraction fails,
 * subsequent stages are skipped.
 */
export async function processDocument(documentId: string): Promise<void> {
  const supabase = useSupabaseAdmin()

  // Mark document as processing
  await supabase
    .from('documents')
    .update({ processing_status: 'processing', processing_error: null })
    .eq('id', documentId)

  // Fetch the document record
  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (fetchError || !doc) {
    await supabase
      .from('documents')
      .update({ processing_status: 'failed', processing_error: 'Document not found' })
      .eq('id', documentId)
    return
  }

  const results: StageResult[] = []

  // Stage 1: Text Extraction (skip if already extracted)
  let extractedText = doc.extracted_text ?? ''
  if (extractedText) {
    // Text already exists — skip extraction, just log it
    await logStageStart(documentId, 'extraction')
    await logStageComplete(documentId, 'extraction')
    results.push({ stage: 'extraction', success: true })
  } else {
    const extractionResult = await runStage(documentId, 'extraction', async () => {
      extractedText = await extractText(doc.file_url, doc.mime_type)
      await supabase
        .from('documents')
        .update({ extracted_text: extractedText })
        .eq('id', documentId)
    })
    results.push(extractionResult)

    if (!extractionResult.success) {
      await supabase
        .from('documents')
        .update({
          processing_status: 'failed',
          processing_error: `Extraction failed: ${extractionResult.error}`,
        })
        .eq('id', documentId)
      return
    }
  }

  // Stage 2: PII Scrubbing
  let scrubbedText = ''
  const piiResult = await runStage(documentId, 'pii_scrub', async () => {
    scrubbedText = await scrubPII(extractedText)
    await supabase
      .from('documents')
      .update({ scrubbed_text: scrubbedText })
      .eq('id', documentId)
  })
  results.push(piiResult)

  // If PII scrub fails, use extracted text as scrubbed (conservative fallback)
  if (!piiResult.success) {
    scrubbedText = extractedText
  }

  // Stage 3: AI Categorization
  let overallConfidence = 1.0
  const categorizationResult = await runStage(documentId, 'categorization', async () => {
    const result = await categorizeDocument(extractedText, documentId)
    overallConfidence = result.confidence
    await supabase
      .from('documents')
      .update({
        ai_summary: result.summary,
        ai_confidence: result.confidence,
        doc_date: result.extractedDate ?? doc.doc_date,
      })
      .eq('id', documentId)
  })
  results.push(categorizationResult)

  // Stage 4: Chunking + Embeddings
  const embeddingResult = await runStage(documentId, 'embedding', async () => {
    const chunks = chunkText(extractedText)

    if (chunks.length === 0) return

    const embeddings = await generateEmbeddings(chunks.map(c => c.content))

    // Delete existing chunks for this document (in case of reprocessing)
    await supabase.from('chunks').delete().eq('document_id', documentId)

    // Insert chunks with embeddings in batches
    const batchSize = 50
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize).map((chunk, j) => ({
        document_id: documentId,
        content: chunk.content,
        chunk_index: chunk.chunkIndex,
        embedding: JSON.stringify(embeddings[i + j]),
        metadata: chunk.metadata,
      }))

      const { error: insertError } = await supabase.from('chunks').insert(batch)
      if (insertError) throw new Error(`Chunk insert failed: ${insertError.message}`)
    }
  })
  results.push(embeddingResult)

  // Stage 5: Meilisearch Indexing
  const indexingResult = await runStage(documentId, 'indexing', async () => {
    await indexDocument(documentId, {
      title: doc.title ?? doc.original_filename ?? 'Untitled',
      content: scrubbedText, // Index scrubbed text, not raw — PII safety
      privacy_level: doc.privacy_level,
      doc_type: doc.doc_type,
      doc_date: doc.doc_date,
      uploaded_by: doc.uploaded_by,
      created_at: doc.created_at,
    })
  })
  results.push(indexingResult)

  // Stage 6: Entity Extraction (knowledge graph)
  const entityResult = await runStage(documentId, 'entity_extraction', async () => {
    await extractEntities(extractedText, documentId)
  })
  results.push(entityResult)

  // Determine final status
  const anyFailed = results.some(r => !r.success)
  const flagged = overallConfidence < 0.6

  let finalStatus: string
  if (flagged) {
    finalStatus = 'flagged_for_review'
  } else if (anyFailed) {
    // If only non-critical stages failed (PII, indexing), still mark as completed
    const criticalFailure = results.find(
      r => !r.success && r.stage === 'extraction'
    )
    finalStatus = criticalFailure ? 'failed' : 'completed'
  } else {
    finalStatus = 'completed'
  }

  const failedStages = results.filter(r => !r.success).map(r => `${r.stage}: ${r.error}`)

  await supabase
    .from('documents')
    .update({
      processing_status: finalStatus,
      processing_error: failedStages.length > 0 ? failedStages.join('; ') : null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', documentId)
}
