/**
 * PATCH /api/admin/invites/:id
 * Deactivate an invite code. Admin only.
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

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invite ID is required' })

  const { data: invite, error } = await supabase
    .from('invites')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!invite) throw createError({ statusCode: 404, statusMessage: 'Invite not found' })

  // Audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'invite_code_deactivated',
    metadata: { invite_id: id, code: invite.code },
    ip_address: getHeader(event, 'x-forwarded-for') || getHeader(event, 'x-real-ip') || '',
  })

  return invite
})
