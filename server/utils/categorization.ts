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

type SensitivityTier = 'scheme_ops' | 'personal_financial' | 'privileged_legal'

interface CategorizationResult {
  categories: Array<{ categoryId: string; confidence: number }>
  summary: string
  confidence: number
  extractedDate: string | null
  sensitivityTier: SensitivityTier
  suggestedTitle: string | null
  suggestedDocType: string | null
  suggestedPrivacyLevel: 'shared' | 'private' | 'privileged' | null
  privacyReason: string | null
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
    return { categories: [], summary: '', confidence: 0, extractedDate: null, sensitivityTier: 'scheme_ops', suggestedTitle: null, suggestedDocType: null, suggestedPrivacyLevel: null, privacyReason: null }
  }

  const { data: docMeta } = await supabase
    .from('documents')
    .select('email_public_share_requested')
    .eq('id', documentId)
    .single()

  const emailSharedSafetyReview = docMeta?.email_public_share_requested === true

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
  "extractedDate": "<YYYY-MM-DD or null>",
  "suggestedTitle": "<descriptive document title>",
  "suggestedDocType": "<one of: letter, contract, minutes, invoice, financial_statement, legal_opinion, photo, notice, email, other>",
  "suggestedPrivacyLevel": "<shared | private | privileged>",
  "privacyReason": "<1 sentence explaining why this privacy level was chosen>"
}

Privacy classification (South African POPIA Act):
- "shared": General building info safe for all residents — AGM minutes, maintenance notices, financial statements, general complaints, building rules, contractor info, common property photos.
- "private": Contains personal information of identifiable persons — individual levy accounts, personal correspondence, unit-specific financial details, individual complaints naming residents, employment/HR details, personal contact information beyond what's publicly known.
- "privileged": Legal strategy, legal opinions, attorney-client communications, litigation preparation, or documents explicitly marked as privileged/confidential by the body corporate's lawyer.
Default to "shared" when uncertain. Err toward "private" when personal data of identifiable natural persons appears (POPIA s1 definition of personal information). Only use "privileged" for genuine legal professional privilege.

${emailSharedSafetyReview
    ? `EMAIL SHARED-INGESTION MODE (critical): The sender used the address meant for scheme-wide documents, but the system is holding this as private until approved. Be STRICT: use "shared" only for content clearly safe for all owners (AGM minutes, general notices, non-personal scheme correspondence). Use "private" for levy statements, personal letters, unit-specific finances, or anything naming identifiable individuals in a personal capacity. Use "privileged" only for genuine legal privilege. When unsure between shared and private, choose "private".`
    : ''}

Rules:
- Select 1-3 most relevant categories from the tree below
- Use the CHILD category when applicable (more specific = better)
- overallConfidence reflects how sure you are about ALL your categorizations combined
- extractedDate is the date the document was created/sent (NOT today's date), null if not identifiable
- summary should be factual and useful for a trustee reviewing documents
- suggestedTitle should be a clear, descriptive title that identifies the document. Include key details like parties involved, dates, or subject matter. Example: "The Yacht Club Constitution — Amended 20 May 2023" rather than just "Constitution"
- suggestedDocType should be the best matching document type from the list above

Category tree:
${categoryTree}`,
    messages: [
      {
        role: 'user',
        content: `${emailSharedSafetyReview ? '[INGESTION: email to shared archive — apply strict privacy classification]\n\n' : ''}Categorize this document:\n\n${truncatedText}`,
      },
    ],
  })

  logUsage({
    service: 'anthropic',
    model: 'claude-sonnet-4-6',
    operation: 'categorization',
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    document_id: documentId,
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
    return { categories: [], summary: '', confidence: 0, extractedDate: null, sensitivityTier: 'scheme_ops', suggestedTitle: null, suggestedDocType: null, suggestedPrivacyLevel: null, privacyReason: null }
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

  // Determine sensitivity tier from category rules
  const assignedCategoryIds = categoryResults.map(c => c.categoryId)
  let sensitivityTier: SensitivityTier = 'scheme_ops'

  if (assignedCategoryIds.length > 0) {
    const { data: rules } = await supabase
      .from('sensitivity_rules')
      .select('sensitivity_tier')
      .in('category_id', assignedCategoryIds)

    if (rules && rules.length > 0) {
      const tierPriority: Record<string, number> = {
        privileged_legal: 3,
        personal_financial: 2,
        scheme_ops: 1,
      }
      sensitivityTier = rules.reduce((highest, r) => {
        const rTier = r.sensitivity_tier as SensitivityTier
        return (tierPriority[rTier] ?? 0) > (tierPriority[highest] ?? 0) ? rTier : highest
      }, 'scheme_ops' as SensitivityTier)
    }
  }

  // Store sensitivity tier on the document
  await supabase
    .from('documents')
    .update({ sensitivity_tier: sensitivityTier })
    .eq('id', documentId)

  // Validate privacy level
  const validPrivacyLevels = ['shared', 'private', 'privileged'] as const
  const rawPrivacy = parsed.suggestedPrivacyLevel
  const suggestedPrivacyLevel = validPrivacyLevels.includes(rawPrivacy) ? rawPrivacy as typeof validPrivacyLevels[number] : null

  return {
    categories: categoryResults,
    summary: parsed.summary ?? '',
    confidence: typeof parsed.overallConfidence === 'number' ? parsed.overallConfidence : 0.5,
    extractedDate: parsed.extractedDate ?? null,
    sensitivityTier,
    suggestedTitle: parsed.suggestedTitle ?? null,
    suggestedDocType: parsed.suggestedDocType ?? null,
    suggestedPrivacyLevel,
    privacyReason: typeof parsed.privacyReason === 'string' ? parsed.privacyReason : null,
  }
}
