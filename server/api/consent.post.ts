import { serverSupabaseClient } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const { data: { user }, error: authError } = await client.auth.getUser()

  if (authError || !user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event)
  const consentVersion = body?.consent_version
  if (!consentVersion) {
    throw createError({ statusCode: 400, message: 'Missing consent_version' })
  }

  const admin = useSupabaseAdmin()
  const now = new Date().toISOString()

  // Log consent (bypasses RLS with service role)
  const { error: logError } = await admin.from('consent_log').insert({
    user_id: user.id,
    consent_version: consentVersion,
    accepted: true,
    ip_address: getHeader(event, 'x-forwarded-for') || null,
    user_agent: getHeader(event, 'user-agent') || null,
  })

  if (logError) {
    throw createError({ statusCode: 500, message: logError.message })
  }

  // Update profile
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      consent_accepted_at: now,
      consent_version: consentVersion,
    })
    .eq('id', user.id)

  if (profileError) {
    throw createError({ statusCode: 500, message: profileError.message })
  }

  return { success: true }
})
