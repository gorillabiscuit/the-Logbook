/**
 * Document processing pipeline orchestrator.
 * Runs stages sequentially:
 *   extraction → categorization → pii_scrub → embedding → indexing → entity_extraction
 *
 * Categorization runs before PII scrub so we know the sensitivity tier,
 * which determines the scrub strategy (light/heavy/skip).
 *
 * Each stage is logged independently; failures are captured without losing partial results.
 */

type PipelineStage = 'dedup' | 'extraction' | 'pii_scrub' | 'categorization' | 'embedding' | 'indexing' | 'entity_extraction'
type SensitivityTier = 'scheme_ops' | 'personal_financial' | 'privileged_legal'

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
    progress: 0,
    detail: null,
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
        progress: error ? undefined : 100,
        detail: error ? `Failed: ${error}` : 'Complete',
      })
      .eq('id', existing.id)
  }
}

/**
 * Updates the progress and detail of a running pipeline stage.
 * Called at key moments within each stage for live progress feedback.
 */
async function updateStageProgress(documentId: string, stage: PipelineStage, progress: number, detail: string) {
  const supabase = useSupabaseAdmin()

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
      .update({ progress, detail })
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
 * Stage order: extraction → categorization → pii_scrub → embedding → indexing → entity_extraction
 *
 * Categorization runs before PII scrub so the sensitivity tier is known,
 * which determines the scrub strategy.
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

  // Pre-stage: Tier 1 dedup (file hash check — zero API cost)
  let tier1IsDuplicate = false
  await logStageStart(documentId, 'dedup')
  try {
    let fileHash = doc.file_hash as string | null

    // Compute file hash if not already set (e.g. email ingestion without pre-hash)
    if (!fileHash && doc.file_url) {
      await updateStageProgress(documentId, 'dedup', 20, 'Computing file hash...')
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('documents')
        .download(doc.file_url)

      if (!downloadError && fileData) {
        const buffer = Buffer.from(await fileData.arrayBuffer())
        fileHash = computeFileHash(buffer)
        await supabase
          .from('documents')
          .update({ file_hash: fileHash })
          .eq('id', documentId)
      }
    }

    // Check for Tier 1 match
    if (fileHash) {
      await updateStageProgress(documentId, 'dedup', 60, 'Checking for duplicate files...')
      const dedupResult = await checkForDuplicate(documentId, fileHash)

      if (dedupResult.isDuplicate && dedupResult.canonicalDocumentId) {
        await updateStageProgress(documentId, 'dedup', 90, 'Duplicate found — linking to original...')
        await linkDuplicate(documentId, dedupResult.canonicalDocumentId, dedupResult.matchType!)
        tier1IsDuplicate = true
      }
    }

    await logStageComplete(documentId, 'dedup')
  } catch (err: any) {
    await logStageComplete(documentId, 'dedup', err?.message ?? String(err))
    results.push({ stage: 'dedup', success: false, error: err?.message })
  }

  // If Tier 1 found a duplicate, processing is done — linkDuplicate already set status to completed
  if (tier1IsDuplicate) return
  results.push({ stage: 'dedup', success: true })

  // Stage 1: Text Extraction (skip if already extracted)
  let extractedText = doc.extracted_text ?? ''
  if (extractedText) {
    // Text already exists — skip extraction, just log it
    await logStageStart(documentId, 'extraction')
    await logStageComplete(documentId, 'extraction')
    results.push({ stage: 'extraction', success: true })
  } else {
    const extractionResult = await runStage(documentId, 'extraction', async () => {
      extractedText = await extractText(doc.file_url, doc.mime_type, async (progress, detail) => {
        await updateStageProgress(documentId, 'extraction', progress, detail)
      })
      await updateStageProgress(documentId, 'extraction', 95, 'Saving extracted text...')
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

  // Post-extraction: Tier 2 dedup (text fingerprint — saves Claude + embedding costs)
  if (extractedText) {
    const fingerprint = computeTextFingerprint(extractedText)
    if (fingerprint) {
      await supabase
        .from('documents')
        .update({ text_fingerprint: fingerprint })
        .eq('id', documentId)

      const tier2Result = await checkForDuplicate(documentId, null, fingerprint)
      if (tier2Result.isDuplicate && tier2Result.canonicalDocumentId) {
        // Log the Tier 2 match
        await logStageStart(documentId, 'dedup')
        await updateStageProgress(documentId, 'dedup', 80, 'Text content match found — linking to original...')
        await linkDuplicate(documentId, tier2Result.canonicalDocumentId, tier2Result.matchType!)
        await logStageComplete(documentId, 'dedup')
        return
      }
    }
  }

  // Stage 2: AI Categorization (moved before PII scrub to determine sensitivity tier)
  let overallConfidence = 1.0
  let sensitivityTier: SensitivityTier = 'scheme_ops'
  const categorizationResult = await runStage(documentId, 'categorization', async () => {
    await updateStageProgress(documentId, 'categorization', 20, 'Analyzing document with AI...')
    const result = await categorizeDocument(extractedText, documentId)
    overallConfidence = result.confidence
    sensitivityTier = result.sensitivityTier
    await updateStageProgress(documentId, 'categorization', 80, 'Saving categorization results...')

    // Build update payload
    const updatePayload: Record<string, any> = {
      ai_summary: result.summary,
      ai_confidence: result.confidence,
      doc_date: result.extractedDate ?? doc.doc_date,
      sensitivity_tier: sensitivityTier,
    }

    // When auto_analyze is set, let AI fill in title and doc_type
    if (doc.auto_analyze) {
      if (result.suggestedTitle) {
        updatePayload.title = result.suggestedTitle
      }
      if (result.suggestedDocType) {
        updatePayload.doc_type = result.suggestedDocType
      }
    }

    await supabase
      .from('documents')
      .update(updatePayload)
      .eq('id', documentId)
  })
  results.push(categorizationResult)

  // Stage 3: PII Scrubbing (tier-aware)
  let scrubbedTextForIndex = ''
  const piiResult = await runStage(documentId, 'pii_scrub', async () => {
    if (sensitivityTier === 'privileged_legal') {
      await updateStageProgress(documentId, 'pii_scrub', 50, 'Skipping scrub (privileged legal)')
      // Skip scrubbing for privileged legal docs — access is role-restricted
      // Set scrubbed_text to extracted for backwards compat
      await supabase
        .from('documents')
        .update({
          scrubbed_text: extractedText,
          scrubbed_text_heavy: null,
          scrubbed_text_light: null,
        })
        .eq('id', documentId)
      scrubbedTextForIndex = extractedText
      return
    }

    // Always run heavy scrub
    await updateStageProgress(documentId, 'pii_scrub', 20, 'Running heavy PII scrub...')
    const heavyScrubbed = await scrubPII(extractedText, 'heavy')

    if (sensitivityTier === 'scheme_ops') {
      // Scheme ops: run both light and heavy
      await updateStageProgress(documentId, 'pii_scrub', 60, 'Running light PII scrub...')
      const lightScrubbed = await scrubPII(extractedText, 'light')
      await updateStageProgress(documentId, 'pii_scrub', 90, 'Saving scrubbed text...')
      await supabase
        .from('documents')
        .update({
          scrubbed_text: heavyScrubbed, // backwards compat
          scrubbed_text_heavy: heavyScrubbed,
          scrubbed_text_light: lightScrubbed,
        })
        .eq('id', documentId)
      scrubbedTextForIndex = heavyScrubbed
    } else {
      // personal_financial: heavy only
      await updateStageProgress(documentId, 'pii_scrub', 90, 'Saving scrubbed text...')
      await supabase
        .from('documents')
        .update({
          scrubbed_text: heavyScrubbed, // backwards compat
          scrubbed_text_heavy: heavyScrubbed,
          scrubbed_text_light: null,
        })
        .eq('id', documentId)
      scrubbedTextForIndex = heavyScrubbed
    }
  })
  results.push(piiResult)

  // If PII scrub fails, use extracted text as fallback for indexing
  if (!piiResult.success) {
    scrubbedTextForIndex = extractedText
  }

  // Stage 4: Chunking + Embeddings
  const embeddingResult = await runStage(documentId, 'embedding', async () => {
    await updateStageProgress(documentId, 'embedding', 10, 'Chunking text...')
    const chunks = chunkText(extractedText)

    if (chunks.length === 0) return

    const batchSize = 50
    const totalBatches = Math.ceil(chunks.length / batchSize)
    const allEmbeddings: number[][] = []

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1
      const progressPct = 20 + Math.round((batchNum / totalBatches) * 60)
      await updateStageProgress(documentId, 'embedding', progressPct, `Generating embeddings (batch ${batchNum} of ${totalBatches})...`)
      const batch = chunks.slice(i, i + batchSize)
      const batchEmbeddings = await generateEmbeddings(batch.map(c => c.content))
      allEmbeddings.push(...batchEmbeddings)
    }

    // Delete existing chunks for this document (in case of reprocessing)
    await updateStageProgress(documentId, 'embedding', 85, 'Saving chunks to database...')
    await supabase.from('chunks').delete().eq('document_id', documentId)

    // Insert chunks with embeddings in batches
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize).map((chunk, j) => ({
        document_id: documentId,
        content: chunk.content,
        chunk_index: chunk.chunkIndex,
        embedding: JSON.stringify(allEmbeddings[i + j]),
        metadata: chunk.metadata,
      }))

      const { error: insertError } = await supabase.from('chunks').insert(batch)
      if (insertError) throw new Error(`Chunk insert failed: ${insertError.message}`)
    }
  })
  results.push(embeddingResult)

  // Stage 5: Meilisearch Indexing (uses heavy-scrubbed text for PII safety)
  // Re-fetch doc to get potentially updated title/doc_type from categorization
  const { data: updatedDoc } = await supabase
    .from('documents')
    .select('title, doc_type, doc_date')
    .eq('id', documentId)
    .single()

  const indexingResult = await runStage(documentId, 'indexing', async () => {
    await updateStageProgress(documentId, 'indexing', 30, 'Indexing in search...')
    await indexDocument(documentId, {
      title: updatedDoc?.title ?? doc.title ?? doc.original_filename ?? 'Untitled',
      content: scrubbedTextForIndex, // Index heavy-scrubbed text — PII safety
      privacy_level: doc.privacy_level,
      sensitivity_tier: sensitivityTier,
      doc_type: updatedDoc?.doc_type ?? doc.doc_type,
      doc_date: updatedDoc?.doc_date ?? doc.doc_date,
      uploaded_by: doc.uploaded_by,
      created_at: doc.created_at,
    })
  })
  results.push(indexingResult)

  // Stage 6: Entity Extraction (knowledge graph)
  const entityResult = await runStage(documentId, 'entity_extraction', async () => {
    await updateStageProgress(documentId, 'entity_extraction', 20, 'Extracting entities with AI...')
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
      dedup_status: 'unique', // No duplicate found — this is a canonical document
    })
    .eq('id', documentId)
}
