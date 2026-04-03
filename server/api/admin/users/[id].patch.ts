/**
 * PATCH /api/admin/users/:id
 * Update a user's role or active status.
 * Super admin: any user except self. Trustee: owners, tenants, BM, management_co, lawyer only;
 * cannot change super_admin/trustee accounts or assign those roles (same boundary as invites).
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const userId = getRouterParam(event, 'id')

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Prevent self-demotion
  if (userId === user.id) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot modify your own account' })
  }

  const { data: targetProfile, error: targetErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (targetErr || !targetProfile) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  const body = await readBody(event)
  const updates: Record<string, any> = {}

  const validRoles = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner', 'tenant']
  if (body.role && validRoles.includes(body.role)) {
    updates.role = body.role
  }

  if (typeof body.is_active === 'boolean') {
    updates.is_active = body.is_active
    if (!body.is_active) {
      updates.deactivated_at = new Date().toISOString()
    } else {
      updates.deactivated_at = null
    }
  }

  if (Object.keys(updates).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  if (profile.role === 'trustee') {
    if (['super_admin', 'trustee'].includes(targetProfile.role)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only a super admin can modify super admin or trustee accounts',
      })
    }
    if (updates.role === 'super_admin' || updates.role === 'trustee') {
      throw createError({
        statusCode: 403,
        statusMessage: 'Only a super admin can assign the super admin or trustee role',
      })
    }
  }

  const { data: updated, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return updated
})
