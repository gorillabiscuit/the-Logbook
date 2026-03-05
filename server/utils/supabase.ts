import { createClient } from '@supabase/supabase-js'

let _client: ReturnType<typeof createClient> | null = null

export function useSupabaseAdmin() {
  if (_client) return _client

  const config = useRuntimeConfig()
  const url = process.env.SUPABASE_URL || config.supabase?.url
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || config.supabaseServiceRoleKey

  if (!url || !key) {
    throw new Error('Missing Supabase service role credentials')
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return _client
}
