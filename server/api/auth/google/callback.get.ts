import { createHmac } from 'crypto'
import { google } from 'googleapis'

/**
 * GET /api/auth/google/callback
 * Google OAuth callback — browser redirect from Google after consent.
 * Exchanges code for tokens, stores in google_tokens, redirects to /drive.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const supabase = useSupabaseAdmin()
  const query = getQuery(event)

  const { code, state, error: oauthError } = query as {
    code?: string
    state?: string
    error?: string
  }

  // User denied consent on Google
  if (oauthError) {
    return sendRedirect(event, '/drive?error=denied')
  }

  if (!code || !state) {
    return sendRedirect(event, '/drive?error=invalid')
  }

  // Validate HMAC state
  const { googleClientId, googleClientSecret } = config
  const appUrl = config.public.appUrl

  const [stateB64, hmac] = (state as string).split('.')
  if (!stateB64 || !hmac) {
    return sendRedirect(event, '/drive?error=invalid_state')
  }

  const expectedHmac = createHmac('sha256', googleClientSecret)
    .update(stateB64)
    .digest('base64url')

  if (hmac !== expectedHmac) {
    return sendRedirect(event, '/drive?error=invalid_state')
  }

  let statePayload: { userId: string; exp: number }
  try {
    statePayload = JSON.parse(Buffer.from(stateB64, 'base64url').toString())
  } catch {
    return sendRedirect(event, '/drive?error=invalid_state')
  }

  // Check expiry
  if (Date.now() > statePayload.exp) {
    return sendRedirect(event, '/drive?error=expired')
  }

  const userId = statePayload.userId

  // Exchange code for tokens
  const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    `${appUrl}/api/auth/google/callback`,
  )

  let tokens
  try {
    const { tokens: t } = await oauth2Client.getToken(code as string)
    tokens = t
  } catch {
    return sendRedirect(event, '/drive?error=token_exchange')
  }

  if (!tokens.refresh_token) {
    return sendRedirect(event, '/drive?error=no_refresh_token')
  }

  // Fetch Google email for display
  oauth2Client.setCredentials(tokens)
  let googleEmail = ''
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()
    googleEmail = userInfo.data.email ?? ''
  } catch {
    // Non-critical — continue without email
  }

  // Store tokens in google_tokens (try insert, fallback to update)
  const now = new Date().toISOString()
  const tokenData = {
    user_id: userId,
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope ?? null,
    google_email: googleEmail,
    connected_at: now,
    updated_at: now,
  }

  // Try insert first, update if user already has a row
  const { error: insertError } = await supabase
    .from('google_tokens')
    .insert(tokenData)

  let upsertError = insertError
  if (insertError?.code === '23505') {
    // Unique violation — row already exists, update instead
    const { error: updateError } = await supabase
      .from('google_tokens')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expiry: tokenData.token_expiry,
        scope: tokenData.scope,
        google_email: tokenData.google_email,
        connected_at: now,
        updated_at: now,
      })
      .eq('user_id', userId)
    upsertError = updateError
  }

  if (upsertError) {
    console.error('Failed to store Google tokens:', JSON.stringify(upsertError))
    console.error('User ID:', userId)
    console.error('Token data keys:', Object.keys(tokenData))
    return sendRedirect(event, `/drive?error=storage&detail=${encodeURIComponent(upsertError.message || upsertError.code || 'unknown')}`)
  }

  return sendRedirect(event, '/drive?connected=true')
})
