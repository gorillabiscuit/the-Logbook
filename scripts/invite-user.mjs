#!/usr/bin/env node
/**
 * Send Supabase Auth invite (same behaviour as POST /api/admin/invite).
 * Usage:
 *   node --env-file=.env scripts/invite-user.mjs <email> <role> [full_name]
 *
 * Requires: NUXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.
 * Requires: INVITE_APP_URL or NUXT_PUBLIC_APP_URL (base URL, no trailing slash) for redirect to /confirm.
 * If NUXT_PUBLIC_APP_URL is localhost, you MUST set INVITE_APP_URL to the real production origin
 * (invites are blocked on localhost unless INVITE_ALLOW_LOCALHOST=1 for local-only testing).
 *
 * Example:
 *   node --env-file=.env scripts/invite-user.mjs raymond@example.com building_manager "Raymond Palm"
 */
import { createClient } from '@supabase/supabase-js'

const emailArg = process.argv[2]
const roleArg = process.argv[3] || 'owner'
const fullNameArg = process.argv[4] || ''

const validRoles = [
  'super_admin',
  'trustee',
  'lawyer',
  'building_manager',
  'management_co',
  'owner',
  'tenant',
]

if (!emailArg?.includes('@')) {
  console.error('Usage: node --env-file=.env scripts/invite-user.mjs <email> <role> [full_name]')
  process.exit(1)
}

if (!validRoles.includes(roleArg)) {
  console.error(`Invalid role. Must be one of: ${validRoles.join(', ')}`)
  process.exit(1)
}

const url = process.env.NUXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
const appUrl = (process.env.INVITE_APP_URL || process.env.NUXT_PUBLIC_APP_URL || '')
  .replace(/\/$/, '')

if (!url || !key) {
  console.error('Missing NUXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)')
  process.exit(1)
}

if (!appUrl) {
  console.error(
    'Missing INVITE_APP_URL or NUXT_PUBLIC_APP_URL (e.g. https://your-app.vercel.app) for invite redirect',
  )
  process.exit(1)
}

function isLocalDevOrigin(u) {
  try {
    const { hostname } = new URL(u.startsWith('http') ? u : `https://${u}`)
    return (
      hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname.endsWith('.local')
    )
  } catch {
    return /localhost|127\.0\.0\.1/i.test(u)
  }
}

if (isLocalDevOrigin(appUrl) && !process.env.INVITE_ALLOW_LOCALHOST) {
  console.error(
    'Invite redirect would use a local URL — real users cannot complete signup that way.\n' +
      'Set INVITE_APP_URL to your production origin, e.g.:\n' +
      '  INVITE_APP_URL=https://your-app.vercel.app node --env-file=.env scripts/invite-user.mjs ...\n' +
      'Or set NUXT_PUBLIC_APP_URL in .env to production for deploys.\n' +
      'For intentional local-only invites: INVITE_ALLOW_LOCALHOST=1',
  )
  process.exit(1)
}

const redirectTo = `${appUrl}/confirm`
const email = emailArg.trim().toLowerCase()

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
  redirectTo,
  data: {
    full_name: fullNameArg.trim(),
    role: roleArg,
    unit_number: '',
  },
})

if (error) {
  console.error('Invite failed:', error.message)
  process.exit(1)
}

console.log('Invite sent:', email, 'role:', roleArg, 'redirectTo:', redirectTo)
console.log('user_id:', data.user?.id ?? '(pending)')
