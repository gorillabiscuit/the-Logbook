/**
 * POST /api/admin/invite
 * Send a single invite email. Admin only.
 * Body: { email, role?, full_name?, unit_number? }
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  if (!body?.email?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Email is required' })
  }

  const email = body.email.trim().toLowerCase()
  const role = body.role || 'owner'
  const fullName = body.full_name?.trim() || ''
  const unitNumber = body.unit_number?.trim() || ''

  const validRoles = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner', 'tenant']
  if (!validRoles.includes(role)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
  }

  // Only super_admin can invite super_admins
  if (role === 'super_admin' && profile.role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Only a super admin can invite another super admin' })
  }

  // Derive base URL for redirect
  const host = getHeader(event, 'host') || 'localhost:3000'
  const protocol = getHeader(event, 'x-forwarded-proto') || 'http'
  const redirectTo = `${protocol}://${host}/confirm`

  // Use inviteUserByEmail — sends magic link email, creates user if doesn't exist
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      full_name: fullName,
      role,
      unit_number: unitNumber,
    },
  })

  if (inviteError) {
    throw createError({ statusCode: 400, statusMessage: inviteError.message })
  }

  // Log to audit_log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'invite_sent',
    target_email: email,
    metadata: { role, full_name: fullName, unit_number: unitNumber },
    ip_address: getHeader(event, 'x-forwarded-for') || getHeader(event, 'x-real-ip') || '',
  })

  return { success: true, email, user_id: inviteData.user?.id }
})
