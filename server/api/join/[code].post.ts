/**
 * POST /api/join/:code
 * Claim an invite code (public route — no auth required).
 * Body: { email, full_name?, unit_number? }
 * Validates code, calls inviteUserByEmail(), records claim + audit.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Invite code is required' })

  const body = await readBody(event)
  if (!body?.email?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Email is required' })
  }

  const email = body.email.trim().toLowerCase()
  const fullName = body.full_name?.trim() || ''
  const unitNumber = body.unit_number?.trim() || ''

  // Fetch and validate the invite code
  const { data: invite, error: fetchError } = await supabase
    .from('invites')
    .select('id, code, role, max_uses, uses_count, expires_at, is_active')
    .eq('code', code)
    .single()

  if (fetchError || !invite) {
    throw createError({ statusCode: 404, statusMessage: 'Invite code not found' })
  }

  if (!invite.is_active) {
    throw createError({ statusCode: 410, statusMessage: 'This invite has been deactivated' })
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    throw createError({ statusCode: 410, statusMessage: 'This invite has expired' })
  }

  if (invite.max_uses && invite.uses_count >= invite.max_uses) {
    throw createError({ statusCode: 410, statusMessage: 'This invite has reached its maximum number of uses' })
  }

  // Check if this email has already claimed this code
  const { data: existingClaim } = await supabase
    .from('invite_claims')
    .select('id')
    .eq('invite_id', invite.id)
    .eq('email', email)
    .maybeSingle()

  if (existingClaim) {
    throw createError({ statusCode: 409, statusMessage: 'This email has already used this invite code' })
  }

  // Derive base URL for redirect
  const host = getHeader(event, 'host') || 'localhost:3000'
  const protocol = getHeader(event, 'x-forwarded-proto') || 'http'
  const redirectTo = `${protocol}://${host}/confirm`

  // Send the invite email
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      full_name: fullName,
      role: invite.role,
      unit_number: unitNumber,
    },
  })

  if (inviteError) {
    throw createError({ statusCode: 400, statusMessage: inviteError.message })
  }

  // Increment uses_count
  await supabase
    .from('invites')
    .update({ uses_count: invite.uses_count + 1 })
    .eq('id', invite.id)

  // Record the claim
  await supabase.from('invite_claims').insert({
    invite_id: invite.id,
    email,
    user_id: inviteData.user?.id || null,
  })

  // Audit log
  const ipAddress = getHeader(event, 'x-forwarded-for') || getHeader(event, 'x-real-ip') || ''
  await supabase.from('audit_log').insert({
    action: 'invite_code_claimed',
    target_email: email,
    metadata: { code: invite.code, role: invite.role, full_name: fullName, unit_number: unitNumber },
    ip_address: ipAddress,
  })

  return { success: true, message: 'Invite sent — check your email for a magic link' }
})
