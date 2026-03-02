import { google } from 'googleapis'

const ALLOWED_ROLES = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner']

/**
 * POST /api/drive/disconnect
 * Revokes the user's Google Drive token and removes it from the database.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
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

  // Get current tokens
  const { data: tokenRow } = await supabase
    .from('google_tokens')
    .select('access_token, refresh_token')
    .eq('user_id', user.id)
    .single()

  if (!tokenRow) {
    return { success: true }
  }

  // Try to revoke with Google (best effort)
  try {
    const oauth2Client = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
    )
    await oauth2Client.revokeToken(tokenRow.refresh_token)
  } catch {
    // Revocation failure is non-critical — we still delete locally
  }

  // Delete from DB
  await supabase
    .from('google_tokens')
    .delete()
    .eq('user_id', user.id)

  return { success: true }
})
