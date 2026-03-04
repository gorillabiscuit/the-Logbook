/**
 * DELETE /api/issues/:id/documents
 * Unlinks a document from an issue. Admin only (super_admin, trustee).
 */
export default defineEventHandler(async (event) => {
  const issueId = getRouterParam(event, 'id')
  if (!issueId) throw createError({ statusCode: 400, statusMessage: 'Issue ID required' })

  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Admin only
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile?.role || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  const documentId = body?.document_id
  if (!documentId) throw createError({ statusCode: 400, statusMessage: 'document_id required' })

  // Delete the link (idempotent — deleting a non-existent link is a no-op)
  const { error } = await supabase
    .from('issue_documents')
    .delete()
    .eq('issue_id', issueId)
    .eq('document_id', documentId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
