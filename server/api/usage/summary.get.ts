/**
 * GET /api/usage/summary
 * Returns API usage summaries.
 * Admins (super_admin, trustee) see all operations.
 * Regular users see only their own chat/query_embedding usage.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  // Authenticate
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Get profile for role check
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) throw createError({ statusCode: 403, statusMessage: 'Profile not found' })

  const isAdmin = ['super_admin', 'trustee'].includes(profile.role)

  // Start of current month (UTC)
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  if (isAdmin) {
    const [allTime, thisMonth] = await Promise.all([
      supabase.rpc('usage_summary'),
      supabase.rpc('usage_summary_since', { since_date: monthStart }),
    ])

    return {
      isAdmin: true,
      allTime: allTime.data ?? [],
      thisMonth: thisMonth.data ?? [],
    }
  }

  // Regular user: only their own usage
  const [allTime, thisMonth] = await Promise.all([
    supabase.rpc('usage_summary_for_user', { target_user_id: user.id }),
    supabase.rpc('usage_summary_for_user_since', { target_user_id: user.id, since_date: monthStart }),
  ])

  return {
    isAdmin: false,
    allTime: allTime.data ?? [],
    thisMonth: thisMonth.data ?? [],
  }
})
