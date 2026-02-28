/**
 * RAG query orchestration using Claude + pgvector.
 * Retrieves relevant document chunks via semantic search,
 * constructs a context-aware prompt, and synthesises an answer
 * with source citations.
 */
import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (_client) return _client
  const config = useRuntimeConfig()
  const apiKey = config.anthropicApiKey
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  _client = new Anthropic({ apiKey })
  return _client
}

interface SourceChunk {
  chunkId: string
  documentId: string
  documentTitle: string
  content: string
  similarity: number
}

interface RAGResponse {
  answer: string
  sources: SourceChunk[]
}

/**
 * Determines which privacy levels a user role can access for RAG queries.
 */
function getPrivacyFilter(role: string): string[] {
  switch (role) {
    case 'super_admin':
    case 'trustee':
    case 'lawyer':
      return ['shared', 'private', 'privileged']
    case 'building_manager':
    case 'management_co':
      return ['shared']
    case 'owner':
      return ['shared']
    case 'tenant':
      return ['shared']
    default:
      return ['shared']
  }
}

/**
 * Performs a RAG query: embed the question, retrieve relevant chunks,
 * synthesise an answer with Claude, and return sources.
 */
export async function ragQuery(
  question: string,
  role: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<RAGResponse> {
  const supabase = useSupabaseAdmin()

  // 1. Generate query embedding
  const queryEmbedding = await generateQueryEmbedding(question)

  // 2. Retrieve matching chunks via pgvector
  const privacyFilter = getPrivacyFilter(role)

  const { data: chunks, error: matchError } = await supabase.rpc('match_chunks', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.3,
    match_count: 8,
    filter_privacy: privacyFilter,
  })

  if (matchError) {
    console.error('match_chunks error:', matchError)
    throw new Error('Failed to retrieve relevant documents')
  }

  // 3. Fetch document titles for the matched chunks
  const documentIds = [...new Set((chunks ?? []).map((c: any) => c.document_id))]
  let docTitleMap: Record<string, string> = {}

  if (documentIds.length > 0) {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, title, original_filename')
      .in('id', documentIds)

    if (docs) {
      for (const doc of docs) {
        docTitleMap[doc.id] = doc.title || doc.original_filename || 'Untitled'
      }
    }
  }

  // 4. Build source references
  const sources: SourceChunk[] = (chunks ?? []).map((chunk: any) => ({
    chunkId: chunk.id,
    documentId: chunk.document_id,
    documentTitle: docTitleMap[chunk.document_id] || 'Untitled',
    content: chunk.content,
    similarity: chunk.similarity,
  }))

  // 5. Build context block for Claude
  const contextBlock = sources.length > 0
    ? sources
        .map((s, i) => `[Source ${i + 1}: "${s.documentTitle}"]\n${s.content}`)
        .join('\n\n---\n\n')
    : 'No relevant documents found in the knowledge base.'

  // 6. Build conversation messages for Claude
  const systemPrompt = `You are the AI assistant for The Yacht Club body corporate in Cape Town, South Africa. You help trustees, owners, and residents understand their building's history, rules, finances, and operations by answering questions based on the document archive.

CONTEXT FROM DOCUMENTS:
${contextBlock}

RULES:
- Answer based ONLY on the provided document context. Do not make up information.
- If the context doesn't contain enough information to answer fully, say so clearly.
- When referencing information, cite the source using [Source N] notation.
- Be concise but thorough. Use bullet points for lists.
- If asked about legal matters, note that you're providing information from documents, not legal advice.
- Respond in the same language as the question (English or Afrikaans).
- If no relevant documents were found, explain that and suggest the user try rephrasing or uploading relevant documents.`

  const messages: Anthropic.MessageParam[] = []

  // Include conversation history (last 10 exchanges max for context window)
  const recentHistory = conversationHistory.slice(-20)
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })
  }

  // Add the current question
  messages.push({
    role: 'user',
    content: question,
  })

  // 7. Call Claude
  const client = getAnthropicClient()
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  return {
    answer: content.text,
    sources,
  }
}
