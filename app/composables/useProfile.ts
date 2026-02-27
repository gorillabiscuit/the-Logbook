interface Profile {
  id: string
  full_name: string
  email: string
  phone: string | null
  unit_number: string | null
  role: string
  is_active: boolean
  consent_accepted_at: string | null
  consent_version: string | null
  created_at: string
}

const profile = ref<Profile | null>(null)

export function useProfile() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const fetchProfile = async () => {
    if (!user.value) {
      profile.value = null
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.value.id)
      .single()

    if (error) {
      console.error('Failed to fetch profile:', error)
      return
    }

    profile.value = data as Profile
  }

  const clearProfile = () => {
    profile.value = null
  }

  const hasConsented = computed(() => !!profile.value?.consent_accepted_at)

  return {
    profile,
    fetchProfile,
    clearProfile,
    hasConsented,
  }
}
