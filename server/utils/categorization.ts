/**
 * AI-powered document categorization using Claude.
 * Sends extracted text + the category tree to Claude, returns
 * category IDs with confidence scores, a summary, and extracted date.
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

interface CategorizationResult {
  categories: Array<{ categoryId: string; confidence: number }>
  summary: string
  confidence: number
  extractedDate: string | null
}

/**
 * Categorizes a document by analyzing its text against the category tree.
 * Also generates a summary and extracts the document date if identifiable.
 */
export async function categorizeDocument(
  text: string,
  documentId: string
): Promise<CategorizationResult> {
  const supabase = useSupabaseAdmin()

  // Fetch full category tree
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, parent_id')
    .order('name')

  if (!categories || categories.length === 0) {
    return { categories: [], summary: '', confidence: 0, extractedDate: null }
  }

  // Build category tree string for the prompt
  const parents = categories.filter(c => !c.parent_id)
  const categoryTree = parents
    .map(parent => {
      const children = categories.filter(c => c.parent_id === parent.id)
      const childLines = children.map(c => `    - "${c.name}" (id: ${c.id})`).join('\n')
      return `  - "${parent.name}" (id: ${parent.id})\n${childLines}`
    })
    .join('\n')

  const client = getAnthropicClient()

  // Truncate very long texts to fit token limits
  const truncatedText = text.length > 12000 ? text.slice(0, 12000) + '\n\n[... text truncated ...]' : text

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: `You are a document classification AI for a South African residential body corporate (The Yacht Club, Cape Town). Analyze documents and return structured JSON.

You must respond with ONLY a JSON object (no markdown, no explanation) matching this schema:
{
  "categories": [
    { "categoryId": "<uuid>", "confidence": <0.0-1.0> }
  ],
  "summary": "<2-3 sentence summary of the document>",
  "overallConfidence": <0.0-1.0>,
  "extractedDate": "<YYYY-MM-DD or null>"
}

Rules:
- Select 1-3 most relevant categories from the tree below
- Use the CHILD category when applicable (more specific = better)
- overallConfidence reflects how sure you are about ALL your categorizations combined
- extractedDate is the date the document was created/sent (NOT today's date), null if not identifiable
- summary should be factual and useful for a trustee reviewing documents

Category tree:
${categoryTree}`,
    messages: [
      {
        role: 'user',
        content: `Categorize this document:\n\n${truncatedText}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  let parsed: any
  try {
    // Handle potential markdown code blocks, preamble text, or thinking output
    let jsonStr = content.text
    // Strip markdown code fences
    jsonStr = jsonStr.replace(/```json\n?|\n?```/g, '')
    // Try to find a JSON object in the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON object found in response')
    parsed = JSON.parse(jsonMatch[0])
  } catch (parseError) {
    console.error('Failed to parse categorization response:', content.text, parseError)
    return { categories: [], summary: '', confidence: 0, extractedDate: null }
  }

  // Insert category links
  const categoryResults: CategorizationResult['categories'] = []
  if (Array.isArray(parsed.categories)) {
    for (const cat of parsed.categories) {
      // Verify the category ID actually exists
      const exists = categories.find(c => c.id === cat.categoryId)
      if (exists) {
        categoryResults.push({
          categoryId: cat.categoryId,
          confidence: typeof cat.confidence === 'number' ? cat.confidence : 0.5,
        })

        // Upsert into document_categories (handles reprocessing)
        await supabase
          .from('document_categories')
          .upsert(
            {
              document_id: documentId,
              category_id: cat.categoryId,
              confidence: cat.confidence,
            },
            { onConflict: 'document_id,category_id' }
          )
      }
    }
  }

  return {
    categories: categoryResults,
    summary: parsed.summary ?? '',
    confidence: typeof parsed.overallConfidence === 'number' ? parsed.overallConfidence : 0.5,
    extractedDate: parsed.extractedDate ?? null,
  }
}
