/**
 * GET /api/issues
 * Lists issues with optional filters: status, severity, category_id.
 * Privacy-scoped via RLS.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const query = getQuery(event)

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  let q = supabase
    .from('issues')
    .select('id, title, description, status, severity, privacy_level, created_at, resolved_at, created_by, category_id, profiles:created_by(full_name), categories:category_id(name)')
    .order('created_at', { ascending: false })

  // Privacy filtering
  const isPrivileged = profile?.role && ['super_admin', 'trustee', 'lawyer'].includes(profile.role)
  if (!isPrivileged) {
    q = q.or(`privacy_level.eq.shared,created_by.eq.${user.id}`)
  }

  if (query.status) q = q.eq('status', query.status as string)
  if (query.severity) q = q.eq('severity', query.severity as string)
  if (query.category_id) q = q.eq('category_id', query.category_id as string)

  const { data, error } = await q.limit(100)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data ?? []
})
