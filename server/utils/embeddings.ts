/**
 * Embedding generation using Voyage AI voyage-3.5 (1024 dimensions).
 * Supports batch processing with document/query input types for
 * optimised retrieval performance.
 */
import { VoyageAIClient } from 'voyageai'

let _client: VoyageAIClient | null = null

function getVoyageClient(): VoyageAIClient {
  if (_client) return _client
  const config = useRuntimeConfig()
  const apiKey = config.embeddingApiKey
  if (!apiKey) throw new Error('EMBEDDING_API_KEY not configured')
  _client = new VoyageAIClient({ apiKey })
  return _client
}

const EMBEDDING_MODEL = 'voyage-3.5'
const MAX_BATCH_SIZE = 128 // Voyage AI limit per request

/**
 * Generates embeddings for an array of text strings.
 * Uses input_type "document" for storage embeddings.
 * Handles batching automatically for large input arrays.
 * Returns embeddings in the same order as input.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const client = getVoyageClient()
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE)

    const response = await client.embed({
      input: batch,
      model: EMBEDDING_MODEL,
      inputType: 'document',
    })

    if (response.data) {
      allEmbeddings.push(...response.data.map(d => d.embedding as number[]))
    }
  }

  return allEmbeddings
}

/**
 * Generates a single embedding for a query string (used for semantic search).
 * Uses input_type "query" for retrieval-optimised embedding.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const client = getVoyageClient()

  const response = await client.embed({
    input: [query],
    model: EMBEDDING_MODEL,
    inputType: 'query',
  })

  if (!response.data?.[0]?.embedding) {
    throw new Error('Failed to generate query embedding')
  }

  return response.data[0].embedding as number[]
}
