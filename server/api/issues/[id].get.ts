/**
 * GET /api/issues/:id
 * Returns issue details with linked documents.
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

  const { data: issue, error } = await supabase
    .from('issues')
    .select('*, profiles:created_by(full_name), categories:category_id(name)')
    .eq('id', issueId)
    .single()

  if (error || !issue) throw createError({ statusCode: 404, statusMessage: 'Issue not found' })

  // Check privacy
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isPrivileged = profile?.role && ['super_admin', 'trustee', 'lawyer'].includes(profile.role)
  if (issue.privacy_level !== 'shared' && issue.created_by !== user.id && !isPrivileged) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Fetch linked documents
  const { data: linkedDocs } = await supabase
    .from('issue_documents')
    .select('document_id, documents:document_id(id, title, original_filename)')
    .eq('issue_id', issueId)

  return { ...issue, linked_documents: linkedDocs ?? [] }
})
