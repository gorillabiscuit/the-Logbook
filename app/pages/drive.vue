<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  ssr: false,
})

const toast = useToast()
const route = useRoute()
const supabase = useSupabaseClient()
const { profile, hasRole } = useAuth()
const { connection, loading: connectionLoading, accessDenied, fetchConnection, connect, disconnect } = useDriveConnection()

const canSetPrivileged = computed(() => hasRole(['super_admin', 'trustee', 'lawyer']))

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

// Form state
const folderUrl = ref('')
const privacyLevel = ref('shared')
const privacyOptions = computed(() => {
  const options = [
    { label: 'Shared', value: 'shared' },
    { label: 'Private', value: 'private' },
  ]
  if (canSetPrivileged.value) {
    options.push({ label: 'Privileged', value: 'privileged' })
  }
  return options
})

// Preview state
interface PreviewResult {
  folderId: string
  total: number
  newFiles: number
  alreadySynced: number
  files: Array<{
    id: string
    name: string
    mimeType: string
    size: number
    alreadySynced: boolean
  }>
}
const previewing = ref(false)
const previewResult = ref<PreviewResult | null>(null)

// Sync queue state
type SyncFileStatus = 'pending' | 'syncing' | 'imported' | 'error' | 'removed' | 'already_synced'

interface SyncQueueFile {
  googleFileId: string
  name: string
  mimeType: string
  size: number
  status: SyncFileStatus
  documentId: string | null
  error: string | null
}

const syncQueue = ref<SyncQueueFile[]>([])
const syncActive = ref(false)
const syncAborted = ref(false)

const syncSummary = computed(() => {
  const q = syncQueue.value
  return {
    pending: q.filter(f => f.status === 'pending').length,
    syncing: q.filter(f => f.status === 'syncing').length,
    imported: q.filter(f => f.status === 'imported').length,
    errors: q.filter(f => f.status === 'error').length,
    removed: q.filter(f => f.status === 'removed').length,
    alreadySynced: q.filter(f => f.status === 'already_synced').length,
    total: q.length,
  }
})

const syncProgress = computed(() => {
  const s = syncSummary.value
  const processed = s.imported + s.errors + s.alreadySynced
  const actionable = s.total - s.removed
  return { processed, actionable }
})

// History state
const historyLoading = ref(true)
const syncHistory = ref<{
  totalSynced: number
  lastSync: string | null
  recentSyncs: any[]
}>({ totalSynced: 0, lastSync: null, recentSyncs: [] })

// Disconnect confirmation
const disconnecting = ref(false)

const preview = async () => {
  if (!folderUrl.value.trim()) {
    toast.add({ title: 'Please enter a Google Drive folder URL', color: 'warning' })
    return
  }

  // Abort any running sync before previewing a new folder
  syncAborted.value = true
  previewing.value = true
  previewResult.value = null
  syncQueue.value = []
  syncActive.value = false

  try {
    const headers = await getAuthHeaders()
    const result = await $fetch<PreviewResult>('/api/drive/list', {
      method: 'POST',
      headers,
      body: { folderUrl: folderUrl.value },
    })

    previewResult.value = result

    // Populate sync queue from preview results
    syncQueue.value = result.files.map(f => ({
      googleFileId: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      status: f.alreadySynced ? 'already_synced' as const : 'pending' as const,
      documentId: null,
      error: null,
    }))
  } catch (err: any) {
    toast.add({
      title: 'Preview failed',
      description: err.data?.message ?? err.message,
      color: 'error',
    })
  } finally {
    previewing.value = false
    syncAborted.value = false
  }
}

const sync = async () => {
  if (!previewResult.value) return

  syncActive.value = true
  syncAborted.value = false
  const folderId = previewResult.value.folderId

  try {
    const headers = await getAuthHeaders()

    for (const file of syncQueue.value) {
      if (syncAborted.value) break
      if (file.status !== 'pending') continue

      file.status = 'syncing'
      file.error = null

      try {
        const result = await $fetch<{
          googleFileId: string
          filename: string
          documentId: string | null
          status: 'imported' | 'already_synced' | 'error'
          error?: string
        }>('/api/drive/sync-file', {
          method: 'POST',
          headers,
          body: {
            googleFileId: file.googleFileId,
            fileName: file.name,
            mimeType: file.mimeType,
            folderId,
            privacyLevel: privacyLevel.value,
          },
        })

        file.status = result.status
        file.documentId = result.documentId
        file.error = result.error ?? null
      } catch (err: any) {
        // HTTP-level error (401, 403, etc.)
        if (err.statusCode === 401) {
          file.status = 'error'
          file.error = 'Session expired'
          toast.add({ title: 'Session expired', description: 'Please log in again.', color: 'error' })
          break
        }
        file.status = 'error'
        file.error = err.data?.message ?? err.message ?? 'Unknown error'
      }
    }

    // Summary toast
    const s = syncSummary.value
    if (s.imported > 0 || s.errors > 0) {
      const parts: string[] = []
      if (s.imported > 0) parts.push(`${s.imported} imported`)
      if (s.errors > 0) parts.push(`${s.errors} failed`)
      if (s.alreadySynced > 0) parts.push(`${s.alreadySynced} already synced`)
      toast.add({
        title: syncAborted.value ? 'Sync cancelled' : 'Sync complete',
        description: parts.join(', '),
        color: s.errors > 0 ? 'warning' : 'success',
      })
    }

    fetchHistory()
  } finally {
    syncActive.value = false
  }
}

const removeFile = (googleFileId: string) => {
  const file = syncQueue.value.find(f => f.googleFileId === googleFileId)
  if (file && (file.status === 'pending' || file.status === 'error')) {
    file.status = 'removed'
  }
}

const undoRemove = (googleFileId: string) => {
  const file = syncQueue.value.find(f => f.googleFileId === googleFileId)
  if (file && file.status === 'removed') {
    file.status = 'pending'
    file.error = null
  }
}

const retryFile = async (googleFileId: string) => {
  if (!previewResult.value) return

  const file = syncQueue.value.find(f => f.googleFileId === googleFileId)
  if (!file || file.status !== 'error') return

  file.status = 'syncing'
  file.error = null

  try {
    const headers = await getAuthHeaders()
    const result = await $fetch<{
      googleFileId: string
      filename: string
      documentId: string | null
      status: 'imported' | 'already_synced' | 'error'
      error?: string
    }>('/api/drive/sync-file', {
      method: 'POST',
      headers,
      body: {
        googleFileId: file.googleFileId,
        fileName: file.name,
        mimeType: file.mimeType,
        folderId: previewResult.value.folderId,
        privacyLevel: privacyLevel.value,
      },
    })

    file.status = result.status
    file.documentId = result.documentId
    file.error = result.error ?? null

    if (result.status === 'imported') {
      toast.add({ title: `${file.name} imported`, color: 'success' })
      fetchHistory()
    }
  } catch (err: any) {
    file.status = 'error'
    file.error = err.data?.message ?? err.message ?? 'Unknown error'
  }
}

const abortSync = () => {
  syncAborted.value = true
}

const handleDisconnect = async () => {
  disconnecting.value = true
  try {
    await disconnect()
    toast.add({ title: 'Google Drive disconnected', color: 'success' })
    previewResult.value = null
    syncQueue.value = []
  } catch (err: any) {
    toast.add({
      title: 'Disconnect failed',
      description: err.data?.message ?? err.message,
      color: 'error',
    })
  } finally {
    disconnecting.value = false
  }
}

const fetchHistory = async () => {
  historyLoading.value = true
  try {
    const headers = await getAuthHeaders()
    syncHistory.value = await $fetch<typeof syncHistory.value>('/api/drive/status', { headers })
  } catch {
    // Silently fail — history is non-critical
  } finally {
    historyLoading.value = false
  }
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const formatDate = (iso: string): string => {
  return new Date(iso).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

onMounted(async () => {
  await fetchConnection()

  // Show success toast if just connected
  if (route.query.connected === 'true') {
    toast.add({ title: 'Google Drive connected successfully', color: 'success' })
  } else if (route.query.error) {
    const errorMessages: Record<string, string> = {
      denied: 'Google Drive access was denied.',
      invalid: 'Invalid OAuth response.',
      invalid_state: 'Invalid state parameter. Please try again.',
      expired: 'The authorization link expired. Please try again.',
      token_exchange: 'Failed to exchange authorization code. Please try again.',
      no_refresh_token: 'Google did not provide a refresh token. Please try again.',
      storage: 'Failed to store credentials. Please try again.',
    }
    toast.add({
      title: 'Connection failed',
      description: errorMessages[route.query.error as string] ?? 'An unknown error occurred.',
      color: 'error',
    })
  }

  if (connection.value.connected) {
    fetchHistory()
  }
})
</script>

<template>
  <div class="max-w-4xl">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Google Drive Sync</h1>
      <p class="text-gray-500 dark:text-gray-400 mt-1 text-sm">
        Connect your Google Drive to import files into the platform. All imported files run through the AI processing pipeline.
      </p>
    </div>

    <!-- Access denied -->
    <div v-if="accessDenied" class="text-center py-12">
      <UIcon name="i-heroicons-lock-closed" class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
      <p class="text-gray-500">You don't have permission to access Google Drive Sync.</p>
    </div>

    <!-- Loading connection status -->
    <div v-else-if="connectionLoading" class="text-center py-12">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
    </div>

    <!-- Not connected -->
    <template v-else-if="!connection.connected">
      <UCard>
        <div class="text-center py-8">
          <UIcon name="i-heroicons-cloud-arrow-down" class="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Connect your Google Drive</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
            Sign in with your Google account to import files from your Drive folders. We only request read-only access to your files.
          </p>
          <UButton
            label="Connect Google Drive"
            icon="i-heroicons-link"
            size="lg"
            @click="connect"
          />
        </div>
      </UCard>
    </template>

    <!-- Connected -->
    <template v-else>
      <!-- Connection status bar -->
      <UCard class="mb-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <UIcon name="i-heroicons-check-circle" class="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div class="text-sm font-medium text-gray-900 dark:text-white">
                Connected as {{ connection.googleEmail }}
              </div>
              <div v-if="connection.connectedAt" class="text-xs text-gray-500">
                Connected {{ formatDate(connection.connectedAt) }}
              </div>
            </div>
          </div>
          <UButton
            label="Disconnect"
            icon="i-heroicons-link-slash"
            variant="outline"
            color="error"
            size="sm"
            :loading="disconnecting"
            @click="handleDisconnect"
          />
        </div>
      </UCard>

      <!-- Sync form -->
      <UCard class="mb-6">
        <div class="space-y-4">
          <div>
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
              Google Drive folder URL or ID
            </label>
            <UInput
              v-model="folderUrl"
              placeholder="https://drive.google.com/drive/folders/... or folder ID"
              size="lg"
              icon="i-heroicons-folder"
              :disabled="syncActive"
            />
          </div>

          <div>
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">
              Privacy level for imported files
            </label>
            <USelect
              v-model="privacyLevel"
              :items="privacyOptions"
              value-key="value"
              label-key="label"
              :disabled="syncActive"
            />
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              <span v-if="privacyLevel === 'shared'">
                <strong>Shared</strong> — Visible to all authenticated residents and trustees. Use for general documents like AGM minutes, financial statements, maintenance records, or common complaints.
              </span>
              <span v-else-if="privacyLevel === 'private'">
                <strong>Private</strong> — Visible only to you, trustees, and the lawyer. Use for sensitive personal documents, financial details, or personal correspondence you don't want other residents to see.
              </span>
              <span v-else-if="privacyLevel === 'privileged'">
                <strong>Privileged</strong> — Visible only to trustees and the lawyer. Use for legal opinions, legal strategy, and privileged communications. Not visible to the uploader unless they are a trustee or lawyer.
              </span>
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              label="Preview"
              icon="i-heroicons-eye"
              variant="outline"
              :loading="previewing"
              :disabled="syncActive || !folderUrl.trim()"
              @click="preview"
            />
            <UButton
              v-if="!syncActive"
              label="Sync now"
              icon="i-heroicons-cloud-arrow-down"
              :disabled="previewing || syncSummary.pending === 0"
              @click="sync"
            />
            <UButton
              v-else
              label="Cancel"
              icon="i-heroicons-x-mark"
              variant="outline"
              color="error"
              @click="abortSync"
            />
            <span v-if="syncActive" class="text-sm text-gray-500">
              Syncing {{ syncProgress.processed }} of {{ syncProgress.actionable }}...
            </span>
          </div>
        </div>
      </UCard>

      <!-- Sync queue / file list -->
      <UCard v-if="syncQueue.length > 0" class="mb-6">
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-gray-900 dark:text-white">Files</h2>
            <div class="flex gap-3 text-sm text-gray-500">
              <span>{{ syncSummary.total }} total</span>
              <span v-if="syncSummary.pending > 0">{{ syncSummary.pending }} pending</span>
              <span v-if="syncSummary.imported > 0" class="text-green-600 dark:text-green-400">
                {{ syncSummary.imported }} imported
              </span>
              <span v-if="syncSummary.errors > 0" class="text-red-500">
                {{ syncSummary.errors }} failed
              </span>
              <span v-if="syncSummary.alreadySynced > 0" class="text-gray-400">
                {{ syncSummary.alreadySynced }} already synced
              </span>
              <span v-if="syncSummary.removed > 0" class="text-gray-400">
                {{ syncSummary.removed }} removed
              </span>
            </div>
          </div>

          <div class="max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
            <div
              v-for="file in syncQueue"
              :key="file.googleFileId"
              class="px-3 py-2"
              :class="file.status === 'removed' ? 'opacity-40' : ''"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 min-w-0">
                  <!-- Status icon -->
                  <UIcon
                    v-if="file.status === 'pending'"
                    name="i-heroicons-document"
                    class="w-4 h-4 flex-shrink-0 text-gray-400"
                  />
                  <UIcon
                    v-else-if="file.status === 'syncing'"
                    name="i-heroicons-arrow-path"
                    class="w-4 h-4 flex-shrink-0 text-primary-500 animate-spin"
                  />
                  <UIcon
                    v-else-if="file.status === 'imported'"
                    name="i-heroicons-check-circle"
                    class="w-4 h-4 flex-shrink-0 text-green-500"
                  />
                  <UIcon
                    v-else-if="file.status === 'error'"
                    name="i-heroicons-x-circle"
                    class="w-4 h-4 flex-shrink-0 text-red-500"
                  />
                  <UIcon
                    v-else-if="file.status === 'removed'"
                    name="i-heroicons-minus-circle"
                    class="w-4 h-4 flex-shrink-0 text-gray-300"
                  />
                  <UIcon
                    v-else-if="file.status === 'already_synced'"
                    name="i-heroicons-check-circle"
                    class="w-4 h-4 flex-shrink-0 text-green-500"
                  />

                  <span
                    class="text-sm truncate"
                    :class="{
                      'text-gray-700 dark:text-gray-300': file.status !== 'removed',
                      'text-gray-400 line-through': file.status === 'removed',
                    }"
                  >
                    {{ file.name }}
                  </span>
                </div>

                <div class="flex items-center gap-2 flex-shrink-0">
                  <span class="text-xs text-gray-400">{{ formatBytes(file.size) }}</span>

                  <!-- Already synced badge -->
                  <UBadge v-if="file.status === 'already_synced'" color="neutral" variant="subtle" size="xs">
                    synced
                  </UBadge>

                  <!-- View link for imported files -->
                  <NuxtLink
                    v-if="file.status === 'imported' && file.documentId"
                    :to="`/documents/${file.documentId}`"
                    class="text-xs text-primary-600 hover:underline"
                  >
                    view
                  </NuxtLink>

                  <!-- Retry button for errored files -->
                  <UButton
                    v-if="file.status === 'error'"
                    icon="i-heroicons-arrow-path"
                    variant="ghost"
                    color="primary"
                    size="xs"
                    @click="retryFile(file.googleFileId)"
                  />

                  <!-- Remove button for pending / error files -->
                  <UButton
                    v-if="file.status === 'pending' || file.status === 'error'"
                    icon="i-heroicons-x-mark"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    @click="removeFile(file.googleFileId)"
                  />

                  <!-- Undo button for removed files -->
                  <UButton
                    v-if="file.status === 'removed'"
                    icon="i-heroicons-arrow-uturn-left"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    @click="undoRemove(file.googleFileId)"
                  />
                </div>
              </div>

              <!-- Error message -->
              <div v-if="file.status === 'error' && file.error" class="ml-6 mt-0.5">
                <p class="text-xs text-red-500">{{ file.error }}</p>
              </div>
            </div>
          </div>

          <p v-if="syncSummary.imported > 0" class="text-xs text-gray-500">
            Imported files are being processed in the background. Check the Documents page for progress.
          </p>
        </div>
      </UCard>

      <!-- Sync history -->
      <UCard>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-gray-900 dark:text-white">Sync History</h2>
            <span v-if="syncHistory.totalSynced > 0" class="text-sm text-gray-500">
              {{ syncHistory.totalSynced }} files synced total
            </span>
          </div>

          <div v-if="historyLoading" class="text-center py-6">
            <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 text-gray-400 mx-auto animate-spin" />
          </div>

          <div v-else-if="syncHistory.totalSynced === 0" class="text-center py-6">
            <UIcon name="i-heroicons-cloud-arrow-down" class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p class="text-sm text-gray-500">No files have been synced from Google Drive yet.</p>
          </div>

          <div v-else>
            <p v-if="syncHistory.lastSync" class="text-sm text-gray-500 mb-3">
              Last sync: {{ formatDate(syncHistory.lastSync) }}
            </p>
            <div class="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              <div
                v-for="syncItem in syncHistory.recentSyncs"
                :key="syncItem.id"
                class="flex items-center justify-between px-3 py-2"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <UIcon name="i-heroicons-document" class="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span class="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {{ syncItem.documents?.original_filename ?? syncItem.documents?.title ?? 'Unknown' }}
                  </span>
                </div>
                <div class="flex items-center gap-3 flex-shrink-0">
                  <UBadge
                    v-if="syncItem.documents?.processing_status"
                    :color="syncItem.documents.processing_status === 'completed' ? 'success' : syncItem.documents.processing_status === 'failed' ? 'error' : 'warning'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ syncItem.documents.processing_status }}
                  </UBadge>
                  <span class="text-xs text-gray-400">{{ formatDate(syncItem.synced_at) }}</span>
                  <NuxtLink
                    v-if="syncItem.document_id"
                    :to="`/documents/${syncItem.document_id}`"
                    class="text-xs text-primary-600 hover:underline"
                  >
                    view
                  </NuxtLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </div>
</template>
