/**
 * GET /api/chat/:id
 * Returns all messages for a conversation, with ownership check.
 */
export default defineEventHandler(async (event) => {
  const conversationId = getRouterParam(event, 'id')
  if (!conversationId) throw createError({ statusCode: 400, statusMessage: 'Conversation ID required' })

  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Check user owns this conversation (or is admin)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id, title, user_id, created_at')
    .eq('id', conversationId)
    .single()

  if (convError || !conversation) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }

  const isAdmin = profile?.role && ['super_admin', 'trustee'].includes(profile.role)
  if (conversation.user_id !== user.id && !isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Fetch messages
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('id, role, content, source_chunks, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (msgError) throw createError({ statusCode: 500, statusMessage: msgError.message })

  return {
    conversation,
    messages: messages ?? [],
  }
})
