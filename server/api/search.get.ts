/**
 * GET /api/search?q=...&type=...&limit=...&offset=...
 * Proxies search to Meilisearch with role-based privacy filtering.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = String(query.q ?? '').trim()

  if (!q || q.length < 2) {
    return { hits: [], estimatedTotalHits: 0 }
  }

  const supabase = useSupabaseAdmin()

  // Get the user's auth token from the request header
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  // Verify user and get their role
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )

  if (authError || !user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // Determine which privacy levels this user can see
  const role = profile?.role ?? 'tenant'
  let privacyLevels: string[]

  if (['super_admin', 'trustee', 'lawyer'].includes(role)) {
    privacyLevels = ['shared', 'private', 'privileged']
  } else if (['building_manager', 'management_co'].includes(role)) {
    privacyLevels = ['shared']
  } else {
    // owner, tenant — can see shared (private own-docs handled separately in DB)
    privacyLevels = ['shared']
  }

  const result = await searchDocuments(q, {
    privacyLevels,
    docType: query.type ? String(query.type) : undefined,
    limit: query.limit ? Number(query.limit) : 20,
    offset: query.offset ? Number(query.offset) : 0,
  })

  return result
})
