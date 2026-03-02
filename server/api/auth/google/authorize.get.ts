import { createHmac } from 'crypto'
import { google } from 'googleapis'

const ALLOWED_ROLES = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner']

/**
 * GET /api/auth/google/authorize
 * Generates a Google OAuth URL for the current user to connect their Drive.
 * Returns { url } for the frontend to redirect to.
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

  // Role check — owner+ only (not tenant)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied. Only owners and above can connect Google Drive.' })
  }

  const { googleClientId, googleClientSecret } = config
  const appUrl = config.public.appUrl

  if (!googleClientId || !googleClientSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Google OAuth not configured' })
  }

  if (!appUrl) {
    throw createError({ statusCode: 500, statusMessage: 'APP_URL not configured' })
  }

  // Build HMAC-signed state param (stateless CSRF protection)
  const statePayload = {
    userId: user.id,
    exp: Date.now() + 10 * 60 * 1000, // 10 min expiry
  }
  const stateJson = JSON.stringify(statePayload)
  const stateB64 = Buffer.from(stateJson).toString('base64url')
  const hmac = createHmac('sha256', googleClientSecret)
    .update(stateB64)
    .digest('base64url')
  const state = `${stateB64}.${hmac}`

  const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    `${appUrl}/api/auth/google/callback`,
  )

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
    state,
  })

  return { url }
})
