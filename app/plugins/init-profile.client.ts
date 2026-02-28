/**
 * Client-side plugin that fetches the user profile on app load
 * and watches for auth state changes (login/logout).
 */
export default defineNuxtPlugin(() => {
  const user = useSupabaseUser()
  const { fetchProfile, clearProfile } = useProfile()

  // Fetch profile on initial load if user is already authenticated
  if (user.value) {
    fetchProfile()
  }

  // Watch for auth state changes
  watch(user, (newUser) => {
    if (newUser) {
      fetchProfile()
    } else {
      clearProfile()
    }
  })
})
