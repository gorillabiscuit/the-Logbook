/**
 * DELETE /api/chat/:id
 * Deletes a conversation and all its messages.
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

  // Verify ownership
  const { data: conv } = await supabase
    .from('conversations')
    .select('user_id')
    .eq('id', conversationId)
    .single()

  if (!conv || conv.user_id !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Not your conversation' })
  }

  // Delete (messages cascade via FK)
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
