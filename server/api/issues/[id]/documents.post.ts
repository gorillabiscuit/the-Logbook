/**
 * POST /api/issues/:id/documents
 * Links a document to an issue. Admin only (super_admin, trustee).
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

  // Validate issue exists
  const { data: issue } = await supabase.from('issues').select('id').eq('id', issueId).single()
  if (!issue) throw createError({ statusCode: 404, statusMessage: 'Issue not found' })

  // Validate document exists
  const { data: doc } = await supabase.from('documents').select('id').eq('id', documentId).single()
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Document not found' })

  // Upsert (idempotent — linking an already-linked doc is a no-op)
  const { error } = await supabase
    .from('issue_documents')
    .upsert({ issue_id: issueId, document_id: documentId }, { onConflict: 'issue_id,document_id' })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
