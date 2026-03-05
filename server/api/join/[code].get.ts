/**
 * GET /api/join/:code
 * Validate an invite code (public route — no auth required).
 * Returns the invite details if valid, or an error if invalid.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Invite code is required' })

  const { data: invite, error } = await supabase
    .from('invites')
    .select('id, code, role, max_uses, uses_count, expires_at, is_active')
    .eq('code', code)
    .single()

  if (error || !invite) {
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

  return {
    code: invite.code,
    role: invite.role,
    remaining_uses: invite.max_uses ? invite.max_uses - invite.uses_count : null,
    expires_at: invite.expires_at,
  }
})
