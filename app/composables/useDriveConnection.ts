interface DriveConnection {
  connected: boolean
  googleEmail: string | null
  connectedAt: string | null
}

export function useDriveConnection() {
  const supabase = useSupabaseClient()

  const connection = ref<DriveConnection>({
    connected: false,
    googleEmail: null,
    connectedAt: null,
  })
  const loading = ref(true)
  const accessDenied = ref(false)

  async function getAuthHeaders(): Promise<Record<string, string>> {
    // Wait for session to be available (handles redirect from OAuth)
    let retries = 0
    while (retries < 5) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        return { Authorization: `Bearer ${session.access_token}` }
      }
      retries++
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return {}
  }

  const fetchConnection = async () => {
    loading.value = true
    accessDenied.value = false
    try {
      const headers = await getAuthHeaders()
      connection.value = await $fetch<DriveConnection>('/api/drive/connection', { headers })
    } catch (err: any) {
      if (err?.statusCode === 403 || err?.status === 403) {
        accessDenied.value = true
      }
      connection.value = { connected: false, googleEmail: null, connectedAt: null }
    } finally {
      loading.value = false
    }
  }

  const connect = async () => {
    const headers = await getAuthHeaders()
    const { url } = await $fetch<{ url: string }>('/api/auth/google/authorize', { headers })
    window.location.href = url
  }

  const disconnect = async () => {
    const headers = await getAuthHeaders()
    await $fetch('/api/drive/disconnect', { method: 'POST', headers })
    connection.value = { connected: false, googleEmail: null, connectedAt: null }
  }

  return {
    connection,
    loading,
    accessDenied,
    fetchConnection,
    connect,
    disconnect,
  }
}
