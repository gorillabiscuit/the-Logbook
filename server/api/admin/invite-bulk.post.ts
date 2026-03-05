/**
 * POST /api/admin/invite-bulk
 * Bulk invite users. Admin only.
 * Body: { emails: string[], role?, sendEmail?: boolean }
 *   sendEmail: true  → inviteUserByEmail() each (sends magic link)
 *   sendEmail: false → auth.admin.createUser() each (pre-approve only, no email)
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
  if (!body?.emails || !Array.isArray(body.emails) || body.emails.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'emails array is required' })
  }

  const role = body.role || 'owner'
  const sendEmail = body.sendEmail !== false // default true
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

  const ipAddress = getHeader(event, 'x-forwarded-for') || getHeader(event, 'x-real-ip') || ''
  const results: { email: string; success: boolean; error?: string }[] = []

  for (const rawEmail of body.emails) {
    const email = rawEmail?.trim()?.toLowerCase()
    if (!email) {
      results.push({ email: rawEmail, success: false, error: 'Invalid email' })
      continue
    }

    try {
      if (sendEmail) {
        // Send invite email with magic link
        const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: { role },
        })
        if (inviteError) {
          results.push({ email, success: false, error: inviteError.message })
          continue
        }
      } else {
        // Pre-approve: create user without sending email
        // Generate a random password (user won't use it — they'll use magic link)
        const { error: createErr } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { role },
        })
        if (createErr) {
          results.push({ email, success: false, error: createErr.message })
          continue
        }
      }

      results.push({ email, success: true })
    } catch (e: any) {
      results.push({ email, success: false, error: e.message || 'Unknown error' })
    }
  }

  // Batch audit log entries
  const auditEntries = results
    .filter(r => r.success)
    .map(r => ({
      actor_id: user.id,
      action: sendEmail ? 'invite_bulk' : 'user_pre_approved',
      target_email: r.email,
      metadata: { role, send_email: sendEmail },
      ip_address: ipAddress,
    }))

  if (auditEntries.length > 0) {
    await supabase.from('audit_log').insert(auditEntries)
  }

  const sent = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  return { results, summary: { total: results.length, sent, failed } }
})
