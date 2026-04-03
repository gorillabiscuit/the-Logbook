/**
 * Meilisearch client and document indexing/search operations.
 * Indexes scrubbed_text (not raw) to prevent PII leaking through search.
 */
import { MeiliSearch } from 'meilisearch'

const INDEX_NAME = 'documents'

let _client: MeiliSearch | null = null

function getMeilisearchClient(): MeiliSearch | null {
  if (_client) return _client
  const config = useRuntimeConfig()
  const host = config.public.meilisearchHost
  const apiKey = config.meilisearchApiKey

  if (!host) return null // Meilisearch not configured — skip silently

  _client = new MeiliSearch({
    host,
    apiKey: apiKey || undefined,
  })

  return _client
}

/**
 * Ensures the documents index exists with correct settings.
 */
async function ensureIndex(client: MeiliSearch) {
  try {
    await client.getIndex(INDEX_NAME)
  } catch {
    await client.createIndex(INDEX_NAME, { primaryKey: 'id' })
    const index = client.index(INDEX_NAME)
    await index.updateFilterableAttributes([
      'privacy_level',
      'sensitivity_tier',
      'doc_type',
      'uploaded_by',
    ])
    await index.updateSortableAttributes(['doc_date', 'created_at'])
    await index.updateSearchableAttributes(['title', 'content'])
  }
}

interface DocumentIndexPayload {
  title: string
  content: string
  privacy_level: string
  sensitivity_tier?: string
  doc_type: string | null
  doc_date: string | null
  uploaded_by: string | null
  created_at: string
}

/**
 * Indexes or updates a document in Meilisearch.
 * Uses scrubbed_text as content to avoid PII in search results.
 */
export async function indexDocument(
  documentId: string,
  payload: DocumentIndexPayload
): Promise<void> {
  const client = getMeilisearchClient()
  if (!client) return // Meilisearch not configured — skip silently

  await ensureIndex(client)

  const index = client.index(INDEX_NAME)
  await index.addDocuments([
    {
      id: documentId,
      ...payload,
    },
  ])
}

/**
 * Refreshes Meilisearch row from DB (e.g. after privacy_level changes).
 */
export async function reindexDocumentSearchRow(documentId: string): Promise<void> {
  const supabase = useSupabaseAdmin()
  const { data: row } = await supabase
    .from('documents')
    .select('title, original_filename, doc_type, doc_date, privacy_level, sensitivity_tier, uploaded_by, created_at, scrubbed_text, scrubbed_text_heavy')
    .eq('id', documentId)
    .single()

  if (!row) return

  const content = (row.scrubbed_text_heavy as string | null) || row.scrubbed_text || ''

  await indexDocument(documentId, {
    title: row.title || row.original_filename || 'Untitled',
    content,
    privacy_level: row.privacy_level,
    sensitivity_tier: row.sensitivity_tier ?? undefined,
    doc_type: row.doc_type,
    doc_date: row.doc_date,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at || new Date().toISOString(),
  })
}

/**
 * Removes a document from the Meilisearch index.
 */
export async function removeDocumentFromIndex(documentId: string): Promise<void> {
  const client = getMeilisearchClient()
  if (!client) return

  const index = client.index(INDEX_NAME)
  await index.deleteDocument(documentId)
}

/**
 * Searches documents in Meilisearch with privacy filtering.
 */
export async function searchDocuments(
  query: string,
  options: {
    privacyLevels: string[]
    docType?: string
    limit?: number
    offset?: number
  }
) {
  const client = getMeilisearchClient()
  if (!client) return { hits: [], estimatedTotalHits: 0 }

  await ensureIndex(client)

  const index = client.index(INDEX_NAME)

  // Build privacy filter
  const privacyFilter = options.privacyLevels
    .map(p => `privacy_level = "${p}"`)
    .join(' OR ')

  const filters: string[] = [`(${privacyFilter})`]
  if (options.docType) {
    filters.push(`doc_type = "${options.docType}"`)
  }

  const result = await index.search(query, {
    filter: filters.join(' AND '),
    limit: options.limit ?? 20,
    offset: options.offset ?? 0,
    sort: ['created_at:desc'],
    attributesToHighlight: ['title', 'content'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
    attributesToCrop: ['content'],
    cropLength: 200,
  })

  return {
    hits: result.hits,
    estimatedTotalHits: result.estimatedTotalHits ?? 0,
  }
}
