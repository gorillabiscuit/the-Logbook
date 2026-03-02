const ALLOWED_ROLES = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner']

/**
 * GET /api/drive/connection
 * Returns the current user's Google Drive connection status.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  // Auth check
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Role check
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }

  // Look up token
  const { data: tokenRow } = await supabase
    .from('google_tokens')
    .select('google_email, connected_at')
    .eq('user_id', user.id)
    .single()

  if (!tokenRow) {
    return { connected: false, googleEmail: null, connectedAt: null }
  }

  return {
    connected: true,
    googleEmail: tokenRow.google_email,
    connectedAt: tokenRow.connected_at,
  }
})
