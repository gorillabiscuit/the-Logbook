export function useAuth() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const { profile, fetchProfile, clearProfile } = useProfile()

  const signOut = async () => {
    clearProfile()
    await supabase.auth.signOut()
    await navigateTo('/login')
  }

  const hasRole = (roles: string | string[]) => {
    if (!profile.value) return false
    const allowed = Array.isArray(roles) ? roles : [roles]
    return allowed.includes(profile.value.role)
  }

  const isAdmin = computed(() => hasRole(['super_admin', 'trustee']))
  const isTrustee = computed(() => hasRole(['super_admin', 'trustee']))
  const isLawyer = computed(() => hasRole(['super_admin', 'trustee', 'lawyer']))

  return {
    user,
    profile,
    fetchProfile,
    signOut,
    hasRole,
    isAdmin,
    isTrustee,
    isLawyer,
  }
}
