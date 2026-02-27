export default defineNuxtRouteMiddleware((to) => {
  const user = useSupabaseUser()

  // Allow unauthenticated access to auth pages
  if (to.path === '/login' || to.path === '/consent' || to.path === '/confirm') {
    return
  }

  // Redirect to login if not authenticated
  if (!user.value) {
    return navigateTo('/login')
  }
})
