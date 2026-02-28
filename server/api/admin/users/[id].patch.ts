/**
 * PATCH /api/admin/users/:id
 * Update a user's role or active status. Super admin only.
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
  if (!profile || profile.role !== 'super_admin') {
    throw createError({ statusCode: 403, statusMessage: 'Only super admins can modify users' })
  }

  // Prevent self-demotion
  if (userId === user.id) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot modify your own account' })
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

  const { data: updated, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return updated
})
