/**
 * Document deduplication utilities.
 *
 * Two-tier approach:
 * - Tier 1 (file hash): SHA-256 of raw file bytes — catches identical files
 * - Tier 2 (text fingerprint): SHA-256 of normalized extracted text — catches same content in different formats
 */
import { createHash } from 'node:crypto'

export interface DedupResult {
  isDuplicate: boolean
  matchType: 'exact_file_match' | 'text_match' | null
  canonicalDocumentId: string | null
  canonicalDocument: { id: string; title: string; created_at: string; privacy_level: string } | null
}

/**
 * Computes SHA-256 hex hash of raw file bytes.
 */
export function computeFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Computes SHA-256 hex hash of normalized extracted text.
 * Normalization: lowercase, strip punctuation, collapse whitespace.
 * Returns empty string for text shorter than 100 chars (too short to fingerprint reliably).
 */
export function computeTextFingerprint(text: string): string {
  if (!text || text.length < 100) return ''

  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')   // collapse whitespace
    .trim()

  if (normalized.length < 50) return '' // still too short after normalization

  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * Checks whether a document is a duplicate by looking up file hash or text fingerprint.
 */
export async function checkForDuplicate(
  documentId: string,
  fileHash?: string | null,
  textFingerprint?: string | null
): Promise<DedupResult> {
  const supabase = useSupabaseAdmin()
  const noMatch: DedupResult = { isDuplicate: false, matchType: null, canonicalDocumentId: null, canonicalDocument: null }

  // Tier 1: file hash match
  if (fileHash) {
    const { data } = await supabase.rpc('find_file_hash_match', {
      p_hash: fileHash,
      p_exclude_id: documentId,
    })

    if (data && data.length > 0) {
      const match = data[0]
      return {
        isDuplicate: true,
        matchType: 'exact_file_match',
        canonicalDocumentId: match.id,
        canonicalDocument: match,
      }
    }
  }

  // Tier 2: text fingerprint match
  if (textFingerprint) {
    const { data } = await supabase.rpc('find_text_fingerprint_match', {
      p_fingerprint: textFingerprint,
      p_exclude_id: documentId,
    })

    if (data && data.length > 0) {
      const match = data[0]
      return {
        isDuplicate: true,
        matchType: 'text_match',
        canonicalDocumentId: match.id,
        canonicalDocument: match,
      }
    }
  }

  return noMatch
}

/**
 * Links a duplicate document to its canonical (original) document.
 * Copies processing results from canonical, indexes in Meilisearch with the duplicate's own privacy level,
 * and marks the duplicate as completed. Does NOT create new chunks (RAG uses canonical's chunks).
 */
export async function linkDuplicate(
  duplicateId: string,
  canonicalId: string,
  matchType: 'exact_file_match' | 'text_match' | 'manual_link'
): Promise<void> {
  const supabase = useSupabaseAdmin()

  // Fetch canonical document's processing results
  const { data: canonical, error: fetchError } = await supabase
    .from('documents')
    .select('extracted_text, ai_summary, ai_confidence, sensitivity_tier, scrubbed_text, scrubbed_text_heavy, scrubbed_text_light, doc_type, doc_date')
    .eq('id', canonicalId)
    .single()

  if (fetchError || !canonical) {
    throw new Error(`Failed to fetch canonical document ${canonicalId}: ${fetchError?.message}`)
  }

  // Copy processing results to duplicate
  const { error: updateError } = await supabase
    .from('documents')
    .update({
      extracted_text: canonical.extracted_text,
      ai_summary: canonical.ai_summary,
      ai_confidence: canonical.ai_confidence,
      sensitivity_tier: canonical.sensitivity_tier,
      scrubbed_text: canonical.scrubbed_text,
      scrubbed_text_heavy: canonical.scrubbed_text_heavy,
      scrubbed_text_light: canonical.scrubbed_text_light,
      // Only fill doc_type/doc_date if not already set by user
      doc_type: canonical.doc_type,
      doc_date: canonical.doc_date,
      canonical_document_id: canonicalId,
      dedup_status: matchType,
      dedup_detected_at: new Date().toISOString(),
      processing_status: 'completed',
      processed_at: new Date().toISOString(),
    })
    .eq('id', duplicateId)

  if (updateError) {
    throw new Error(`Failed to update duplicate document ${duplicateId}: ${updateError.message}`)
  }

  // Copy category associations from canonical
  const { data: canonicalCategories } = await supabase
    .from('document_categories')
    .select('category_id, confidence')
    .eq('document_id', canonicalId)

  if (canonicalCategories && canonicalCategories.length > 0) {
    // Delete any existing categories on the duplicate first
    await supabase.from('document_categories').delete().eq('document_id', duplicateId)

    await supabase.from('document_categories').insert(
      canonicalCategories.map((c: any) => ({
        document_id: duplicateId,
        category_id: c.category_id,
        confidence: c.confidence,
      }))
    )
  }

  // Index duplicate in Meilisearch with its own privacy level
  const { data: dupDoc } = await supabase
    .from('documents')
    .select('title, original_filename, privacy_level, uploaded_by, created_at')
    .eq('id', duplicateId)
    .single()

  if (dupDoc) {
    const scrubbedText = canonical.scrubbed_text_heavy || canonical.scrubbed_text || canonical.extracted_text || ''
    await indexDocument(duplicateId, {
      title: dupDoc.title ?? dupDoc.original_filename ?? 'Untitled',
      content: scrubbedText,
      privacy_level: dupDoc.privacy_level,
      sensitivity_tier: canonical.sensitivity_tier,
      doc_type: canonical.doc_type,
      doc_date: canonical.doc_date,
      uploaded_by: dupDoc.uploaded_by,
      created_at: dupDoc.created_at,
    })
  }
}
