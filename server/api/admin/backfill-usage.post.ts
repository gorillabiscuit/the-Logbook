/**
 * POST /api/admin/backfill-usage
 * One-time backfill of estimated API usage from existing processing data.
 * Estimates token counts from document text lengths, chunk counts, and message sizes.
 *
 * Body: { days?: number (default 10), force?: boolean }
 * Returns: { inserted: number, breakdown: Record<string, number> }
 */

const RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
  'voyage-3.5':                { input: 0.06,  output: 0     },
}

function cost(model: string, inputTokens: number, outputTokens: number): number {
  const r = RATES[model]
  return r ? (inputTokens * r.input + outputTokens * r.output) / 1_000_000 : 0
}

/** Rough token estimate: ~4 characters per token for English BPE. */
function tokens(text: string | null | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

// Estimated system prompt sizes (tokens) from reading each utility's actual prompts
const SYSTEM_TOKENS = {
  categorization: 3000,  // includes full category tree
  pii_heavy: 500,
  pii_light: 450,
  entity_extraction: 900,
  chat_base: 200,
  email_triage: 100,
}

export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  // Auth — admin only
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token_ = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token_)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  const body = await readBody(event)
  const days = body?.days ?? 10
  const force = !!body?.force
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  // Guard against double-run
  const { count: existingCount } = await supabase
    .from('api_usage')
    .select('id', { count: 'exact', head: true })

  if (existingCount && existingCount > 0 && !force) {
    throw createError({
      statusCode: 409,
      statusMessage: `${existingCount} usage rows already exist. Send { "force": true } to add backfilled rows anyway.`,
    })
  }

  const rows: Array<Record<string, any>> = []
  const breakdown: Record<string, number> = {}

  function addRow(row: Record<string, any>) {
    rows.push(row)
    breakdown[row.operation] = (breakdown[row.operation] ?? 0) + 1
  }

  // ─── 1. Document pipeline stages ──────────────────────────────

  const { data: docs } = await supabase
    .from('documents')
    .select('id, extracted_text, ai_summary, sensitivity_tier, source_channel, scrubbed_text_heavy, scrubbed_text_light, processed_at')
    .gte('processed_at', cutoff)
    .not('processed_at', 'is', null)

  // Get chunk content lengths per document for embedding estimates
  const docIds = (docs ?? []).map((d: any) => d.id)
  let chunkStats: Record<string, { totalChars: number; count: number }> = {}

  if (docIds.length > 0) {
    const { data: chunks } = await supabase
      .from('chunks')
      .select('document_id, content')
      .in('document_id', docIds)

    for (const chunk of chunks ?? []) {
      const docId = chunk.document_id
      if (!chunkStats[docId]) chunkStats[docId] = { totalChars: 0, count: 0 }
      chunkStats[docId].totalChars += (chunk.content?.length ?? 0)
      chunkStats[docId].count++
    }
  }

  for (const doc of docs ?? []) {
    const textLen = doc.extracted_text?.length ?? 0
    const timestamp = doc.processed_at

    // ── Categorization ──
    if (doc.ai_summary) {
      const inputT = SYSTEM_TOKENS.categorization + tokens(doc.extracted_text?.slice(0, 12000))
      const outputT = tokens(doc.ai_summary) + 150 // JSON overhead
      addRow({
        service: 'anthropic', model: 'claude-sonnet-4-6', operation: 'categorization',
        input_tokens: inputT, output_tokens: outputT,
        estimated_cost_usd: cost('claude-sonnet-4-6', inputT, outputT),
        document_id: doc.id, user_id: null, created_at: timestamp,
      })
    }

    // ── PII Scrub ──
    const tier = doc.sensitivity_tier ?? 'scheme_ops'
    if (tier !== 'privileged_legal' && textLen > 0) {
      const segmentSize = 15000
      const overlap = 200
      const numSegments = textLen <= segmentSize ? 1 : Math.ceil(textLen / (segmentSize - overlap))
      const levels = tier === 'scheme_ops' ? 2 : 1 // heavy + light for scheme_ops

      for (let lvl = 0; lvl < levels; lvl++) {
        const promptTokens = lvl === 0 ? SYSTEM_TOKENS.pii_heavy : SYSTEM_TOKENS.pii_light
        const totalInputT = numSegments * promptTokens + tokens(doc.extracted_text)
        const totalOutputT = tokens(doc.extracted_text) // scrubbed text ≈ same length
        addRow({
          service: 'anthropic', model: 'claude-sonnet-4-6', operation: 'pii_scrub',
          input_tokens: totalInputT, output_tokens: totalOutputT,
          estimated_cost_usd: cost('claude-sonnet-4-6', totalInputT, totalOutputT),
          document_id: doc.id, user_id: null, created_at: timestamp,
        })
      }
    }

    // ── Entity Extraction ──
    // If entities were extracted, there will be entity_mentions for this doc.
    // Simpler: just assume it ran if the document was fully processed.
    if (doc.extracted_text) {
      const inputT = SYSTEM_TOKENS.entity_extraction + tokens(doc.extracted_text?.slice(0, 10000))
      const outputT = 400 // typical entity JSON
      addRow({
        service: 'anthropic', model: 'claude-sonnet-4-6', operation: 'entity_extraction',
        input_tokens: inputT, output_tokens: outputT,
        estimated_cost_usd: cost('claude-sonnet-4-6', inputT, outputT),
        document_id: doc.id, user_id: null, created_at: timestamp,
      })
    }

    // ── Embeddings (Voyage) ──
    const stats = chunkStats[doc.id]
    if (stats && stats.totalChars > 0) {
      const inputT = Math.ceil(stats.totalChars / 4)
      addRow({
        service: 'voyage', model: 'voyage-3.5', operation: 'embedding',
        input_tokens: inputT, output_tokens: 0,
        estimated_cost_usd: cost('voyage-3.5', inputT, 0),
        document_id: doc.id, user_id: null, created_at: timestamp,
      })
    }

    // ── Email Triage (Haiku) ──
    if (doc.source_channel?.startsWith('email_')) {
      const inputT = SYSTEM_TOKENS.email_triage + 300 // typical email body excerpt
      const outputT = 30
      addRow({
        service: 'anthropic', model: 'claude-haiku-4-5-20251001', operation: 'email_triage',
        input_tokens: inputT, output_tokens: outputT,
        estimated_cost_usd: cost('claude-haiku-4-5-20251001', inputT, outputT),
        document_id: doc.id, user_id: null, created_at: timestamp,
      })
    }
  }

  // ─── 2. Chat messages (Claude) ────────────────────────────────

  const { data: assistantMsgs } = await supabase
    .from('messages')
    .select('id, content, source_chunks, created_at, conversation_id')
    .eq('role', 'assistant')
    .gte('created_at', cutoff)

  // Collect conversation IDs to fetch user_ids
  const convIds = [...new Set((assistantMsgs ?? []).map((m: any) => m.conversation_id))]
  let convUserMap: Record<string, string> = {}

  if (convIds.length > 0) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, user_id')
      .in('id', convIds)

    for (const c of convs ?? []) {
      convUserMap[c.id] = c.user_id
    }
  }

  for (const msg of assistantMsgs ?? []) {
    const sourceChunks = Array.isArray(msg.source_chunks) ? msg.source_chunks : []
    const contextTokens = sourceChunks.length * 250 // ~250 tokens per retrieved chunk
    const inputT = SYSTEM_TOKENS.chat_base + contextTokens + 100 // 100 for user question estimate
    const outputT = tokens(msg.content)
    const userId = convUserMap[msg.conversation_id] ?? null

    addRow({
      service: 'anthropic', model: 'claude-sonnet-4-6', operation: 'chat',
      input_tokens: inputT, output_tokens: outputT,
      estimated_cost_usd: cost('claude-sonnet-4-6', inputT, outputT),
      document_id: null, user_id: userId, created_at: msg.created_at,
    })
  }

  // ─── 3. Query embeddings (Voyage — one per user message) ──────

  const { data: userMsgs } = await supabase
    .from('messages')
    .select('id, content, created_at, conversation_id')
    .eq('role', 'user')
    .gte('created_at', cutoff)

  for (const msg of userMsgs ?? []) {
    const inputT = tokens(msg.content)
    const userId = convUserMap[msg.conversation_id] ?? null

    addRow({
      service: 'voyage', model: 'voyage-3.5', operation: 'query_embedding',
      input_tokens: inputT, output_tokens: 0,
      estimated_cost_usd: cost('voyage-3.5', inputT, 0),
      document_id: null, user_id: userId, created_at: msg.created_at,
    })
  }

  // ─── Insert all rows ─────────────────────────────────────────

  if (rows.length > 0) {
    // Insert in batches of 500 to avoid payload limits
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const { error: insertError } = await supabase.from('api_usage').insert(batch)
      if (insertError) {
        throw createError({ statusCode: 500, statusMessage: `Insert failed: ${insertError.message}` })
      }
    }
  }

  const totalCost = rows.reduce((sum, r) => sum + Number(r.estimated_cost_usd), 0)

  return {
    inserted: rows.length,
    estimatedTotalCost: `$${totalCost.toFixed(4)}`,
    documents: (docs ?? []).length,
    chatMessages: (assistantMsgs ?? []).length,
    breakdown,
  }
})
