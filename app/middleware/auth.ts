export default defineNuxtRouteMiddleware((to) => {
  const user = useSupabaseUser()

  // Allow unauthenticated access to auth pages and invite claim pages
  if (to.path === '/login' || to.path === '/consent' || to.path === '/confirm' || to.path.startsWith('/join')) {
    return
  }

  // Redirect to login if not authenticated
  if (!user.value) {
    return navigateTo('/login')
  }
})
