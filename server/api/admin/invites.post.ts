/**
 * POST /api/admin/invites
 * Create a new invite code. Admin only.
 * Body: { code?, role?, max_uses?, expires_in_days? }
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

  const role = body?.role || 'owner'
  const validRoles = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner', 'tenant']
  if (!validRoles.includes(role)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
  }

  // Only super_admin can create codes for super_admin role
  if (role === 'super_admin' && profile.role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Only a super admin can create invite codes for the super admin role' })
  }

  // Generate code if not provided
  const code = body?.code?.trim() || generateCode()
  const maxUses = body?.max_uses ? Number(body.max_uses) : null
  const expiresInDays = body?.expires_in_days ? Number(body.expires_in_days) : null

  let expiresAt: string | null = null
  if (expiresInDays && expiresInDays > 0) {
    const d = new Date()
    d.setDate(d.getDate() + expiresInDays)
    expiresAt = d.toISOString()
  }

  const { data: invite, error } = await supabase
    .from('invites')
    .insert({
      code,
      role,
      max_uses: maxUses,
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'An invite with this code already exists' })
    }
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  // Audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'invite_code_created',
    metadata: { code, role, max_uses: maxUses, expires_at: expiresAt },
    ip_address: getHeader(event, 'x-forwarded-for') || getHeader(event, 'x-real-ip') || '',
  })

  return invite
})

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 to avoid confusion
  const prefix = 'YC-'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return prefix + code
}
