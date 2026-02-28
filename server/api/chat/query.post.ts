/**
 * POST /api/chat/query
 * Sends a user message to the RAG pipeline and returns the AI response.
 * Creates a new conversation if conversationId is not provided.
 *
 * Body: { conversationId?: string, message: string }
 * Returns: { conversationId, userMessage, assistantMessage }
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  // Authenticate
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Get user profile for role-based access
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) throw createError({ statusCode: 403, statusMessage: 'Profile not found' })

  // Parse body
  const body = await readBody(event)
  const message = body?.message?.trim()
  if (!message) throw createError({ statusCode: 400, statusMessage: 'Message is required' })

  let conversationId = body?.conversationId

  // Create conversation if needed
  if (!conversationId) {
    // Auto-generate title from first message (truncated)
    const title = message.length > 60 ? message.slice(0, 57) + '...' : message

    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .insert({ user_id: user.id, title })
      .select('id')
      .single()

    if (convError || !conv) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to create conversation' })
    }
    conversationId = conv.id
  } else {
    // Verify user owns this conversation
    const { data: conv } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', conversationId)
      .single()

    if (!conv || conv.user_id !== user.id) {
      throw createError({ statusCode: 403, statusMessage: 'Not your conversation' })
    }
  }

  // Insert user message
  const { data: userMsg, error: userMsgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: message,
    })
    .select('id, role, content, created_at')
    .single()

  if (userMsgError) throw createError({ statusCode: 500, statusMessage: userMsgError.message })

  // Fetch conversation history for context
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  // Exclude the message we just inserted (it's the current question)
  const conversationHistory = (history ?? [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(0, -1) // Remove the last entry (the question we just inserted)

  // Run RAG query
  const ragResult = await ragQuery(message, profile.role, conversationHistory)

  // Build source_chunks metadata
  const sourceChunks = ragResult.sources.map(s => ({
    chunkId: s.chunkId,
    documentId: s.documentId,
    documentTitle: s.documentTitle,
    similarity: s.similarity,
  }))

  // Insert assistant message
  const { data: assistantMsg, error: assistantMsgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: ragResult.answer,
      source_chunks: sourceChunks,
    })
    .select('id, role, content, source_chunks, created_at')
    .single()

  if (assistantMsgError) throw createError({ statusCode: 500, statusMessage: assistantMsgError.message })

  // Update conversation's updated_at
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  return {
    conversationId,
    userMessage: userMsg,
    assistantMessage: assistantMsg,
  }
})
