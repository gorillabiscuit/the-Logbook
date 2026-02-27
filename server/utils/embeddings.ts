/**
 * Embedding generation using OpenAI text-embedding-3-small (1536 dimensions).
 * Supports batch processing for efficient embedding of multiple chunks.
 */
import OpenAI from 'openai'

let _client: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (_client) return _client
  const config = useRuntimeConfig()
  const apiKey = config.embeddingApiKey
  if (!apiKey) throw new Error('EMBEDDING_API_KEY not configured')
  _client = new OpenAI({ apiKey })
  return _client
}

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const MAX_BATCH_SIZE = 100 // OpenAI limit per request

/**
 * Generates embeddings for an array of text strings.
 * Handles batching automatically for large input arrays.
 * Returns embeddings in the same order as input.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const client = getOpenAIClient()
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE)

    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    })

    // OpenAI returns embeddings sorted by index
    const sorted = response.data.sort((a, b) => a.index - b.index)
    allEmbeddings.push(...sorted.map(d => d.embedding))
  }

  return allEmbeddings
}

/**
 * Generates a single embedding for a query string (used for semantic search).
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([query])
  return embedding
}
