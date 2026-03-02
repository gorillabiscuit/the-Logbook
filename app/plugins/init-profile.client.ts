/**
 * Client-side plugin that fetches the user profile on app load
 * and watches for auth state changes (login/logout).
 *
 * Watches user.value?.id specifically (not the user ref) so the watcher
 * fires when the id becomes available, even if the user object was set
 * in an intermediate state first.
 */
export default defineNuxtPlugin(() => {
  const user = useSupabaseUser()
  const { fetchProfile, clearProfile } = useProfile()

  watch(() => user.value?.id, (id) => {
    if (id) {
      fetchProfile()
    } else {
      clearProfile()
    }
  }, { immediate: true })
})
