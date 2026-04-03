<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
  ssr: false,
})

const route = useRoute()
const supabase = useSupabaseClient()
const toast = useToast()
const { hasRole, profile, fetchProfile } = useAuth()

const documentId = route.params.id as string
const doc = ref<any>(null)
const categories = ref<any[]>([])
const processingStages = ref<any[]>([])
const loading = ref(true)
const textView = ref('scrubbed')
const reprocessing = ref(false)
const deleting = ref(false)
const deleteModalOpen = ref(false)

// Deduplication
const canonicalDoc = ref<{ id: string; title: string | null } | null>(null)
const documentCopies = ref<Array<{ id: string; title: string | null; created_at: string | null }>>([])

const isDuplicate = computed(() => !!doc.value?.canonical_document_id)
const isCanonical = computed(() => !doc.value?.canonical_document_id && documentCopies.value.length > 0)

const dedupStatusLabels: Record<string, string> = {
  exact_file_match: 'Exact file match',
  text_match: 'Text content match',
  manual_link: 'Manually linked',
}

const isAdmin = computed(() => hasRole(['super_admin', 'trustee']))
const isSubmitter = computed(() => doc.value?.uploaded_by === profile.value?.id)

/** Email to share@: AI could not auto-approve; sender chooses shared vs private */
const showEmailShareConfirm = computed(
  () => doc.value?.share_publication_status === 'pending_sender_confirm' && isSubmitter.value,
)
const confirmShareLoading = ref(false)
const isPrivileged = computed(() => hasRole(['super_admin', 'trustee', 'lawyer']))

const canDownload = computed(() => {
  if (!doc.value?.file_url) return false
  if (isSubmitter.value) return true
  if (isPrivileged.value) return true

  const role = profile.value?.role ?? ''
  const tier = doc.value.sensitivity_tier ?? 'scheme_ops'

  if (tier === 'scheme_ops') return ['owner', 'building_manager'].includes(role)
  return false
})

const downloadDisabledReason = computed(() => {
  if (canDownload.value || !doc.value) return ''
  const tier = doc.value.sensitivity_tier ?? 'scheme_ops'
  if (tier === 'personal_financial') {
    return 'This document contains personal financial information and cannot be downloaded per POPIA requirements'
  }
  if (tier === 'privileged_legal') {
    return 'This is a privileged legal document. Only trustees and lawyers can access it.'
  }
  return 'You do not have permission to download this document'
})

// Determine the best scrubbed text to show based on tier and role
const textToShow = computed(() => {
  if (!doc.value) return ''

  // Submitter or privileged: allow toggle between original and scrubbed
  if (isSubmitter.value || isPrivileged.value) {
    if (textView.value === 'original') return doc.value.extracted_text ?? ''
    // Show best available scrubbed version
    return doc.value.scrubbed_text_heavy || doc.value.scrubbed_text || doc.value.extracted_text || ''
  }

  const tier = doc.value.sensitivity_tier ?? 'scheme_ops'

  // Owner viewing scheme_ops: show light scrub
  if (tier === 'scheme_ops') {
    return doc.value.scrubbed_text_light || doc.value.scrubbed_text || doc.value.extracted_text || ''
  }

  // Owner viewing personal_financial: show heavy scrub
  return doc.value.scrubbed_text_heavy || doc.value.scrubbed_text || ''
})

// Can toggle between original/scrubbed view
const canToggleText = computed(() => {
  return (isSubmitter.value || isPrivileged.value) && doc.value?.extracted_text && (doc.value?.scrubbed_text || doc.value?.scrubbed_text_heavy)
})

// Scrub notice text
const scrubNotice = computed(() => {
  if (!doc.value) return ''
  if (isSubmitter.value) return 'You are viewing your own submission — full content shown.'
  if (isPrivileged.value) return ''

  const tier = doc.value.sensitivity_tier ?? 'scheme_ops'
  if (tier === 'scheme_ops') {
    return 'Some personal details (bank accounts, ID numbers) have been redacted per POPIA.'
  }
  return 'Personal information has been redacted in accordance with POPIA. Trustees and the scheme\'s legal representative can view the full document.'
})

// Escape HTML then highlight [REDACTED_*] markers with green background
const highlightedText = computed(() => {
  const raw = textToShow.value
  if (!raw) return ''
  // Escape HTML entities to prevent XSS when using v-html
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  // Wrap [REDACTED_*] markers in a highlighted span
  return escaped.replace(
    /\[REDACTED_[A-Z_]+\]/g,
    match => `<span class="redacted-marker">${match}</span>`
  )
})

// Has any text to display
const hasText = computed(() => {
  if (!doc.value) return false
  return !!(doc.value.extracted_text || doc.value.scrubbed_text || doc.value.scrubbed_text_light || doc.value.scrubbed_text_heavy)
})

const privacyColors: Record<string, 'success' | 'warning' | 'error'> = {
  shared: 'success',
  private: 'warning',
  privileged: 'error',
}

const sensitivityColors: Record<string, 'success' | 'warning' | 'error'> = {
  scheme_ops: 'success',
  personal_financial: 'warning',
  privileged_legal: 'error',
}

const sensitivityLabels: Record<string, string> = {
  scheme_ops: 'Scheme Ops',
  personal_financial: 'Personal Financial',
  privileged_legal: 'Privileged',
}

const statusColors: Record<string, 'neutral' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  processing: 'warning',
  completed: 'success',
  failed: 'error',
  flagged_for_review: 'warning',
}

// Detect if document is stuck — uses processing stage timestamps for precision
const isStuck = computed(() => {
  if (!doc.value || !['pending', 'processing'].includes(doc.value.processing_status)) return false

  // Check if any stage has been "running" for >10 minutes
  if (processingStages.value.length > 0) {
    const runningStage = processingStages.value.find((s: any) => s.status === 'running')
    if (runningStage?.started_at) {
      const elapsed = Date.now() - new Date(runningStage.started_at).getTime()
      if (elapsed > 10 * 60 * 1000) return true
    }
  }

  // Fallback: check created_at
  const createdAt = new Date(doc.value.created_at).getTime()
  const elapsed = Date.now() - createdAt
  if (doc.value.processing_status === 'processing') return elapsed > 10 * 60 * 1000
  if (doc.value.processing_status === 'pending') return elapsed > 5 * 60 * 1000
  return false
})

const stageStatusColors: Record<string, 'neutral' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  running: 'warning',
  completed: 'success',
  failed: 'error',
}

const stageLabels: Record<string, string> = {
  dedup: 'Duplicate Check',
  extraction: 'Text Extraction',
  categorization: 'AI Categorization',
  pii_scrub: 'PII Scrubbing',
  embedding: 'Embeddings',
  indexing: 'Search Indexing',
  entity_extraction: 'Entity Extraction',
}

const stageIcons: Record<string, string> = {
  dedup: 'i-heroicons-document-duplicate',
  extraction: 'i-heroicons-document-text',
  categorization: 'i-heroicons-tag',
  pii_scrub: 'i-heroicons-shield-check',
  embedding: 'i-heroicons-cube-transparent',
  indexing: 'i-heroicons-magnifying-glass',
  entity_extraction: 'i-heroicons-link',
}

const formatElapsed = (startedAt: string, completedAt: string | null) => {
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'Africa/Johannesburg',
  })
}

const formatDateTime = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

const fetchDocument = async () => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (error || !data) {
    toast.add({ title: 'Document not found', color: 'error' })
    navigateTo('/documents')
    return
  }

  doc.value = data
}

const fetchCategories = async () => {
  const { data } = await supabase
    .from('document_categories')
    .select(`
      confidence,
      category:categories(id, name, parent_id)
    `)
    .eq('document_id', documentId)

  categories.value = data ?? []
}

const fetchDedupInfo = async () => {
  if (!doc.value) return

  // If this is a duplicate, fetch the canonical document info
  if (doc.value.canonical_document_id) {
    const { data } = await supabase
      .from('documents')
      .select('id, title')
      .eq('id', doc.value.canonical_document_id)
      .single()
    canonicalDoc.value = data
  }

  // Fetch any copies that point to this document as canonical
  const { data: copies } = await supabase
    .from('documents')
    .select('id, title, created_at')
    .eq('canonical_document_id', documentId)
    .order('created_at', { ascending: true })

  documentCopies.value = copies ?? []
}

const fetchStatus = async () => {
  try {
    const data = await $fetch(`/api/documents/${documentId}/status`)
    processingStages.value = (data as any).stages ?? []
  } catch {
    // Non-critical — status endpoint may not be available yet
  }
}

// Poll for status updates while processing
let pollInterval: ReturnType<typeof setInterval> | null = null

const startPolling = () => {
  if (pollInterval) return
  pollInterval = setInterval(async () => {
    await fetchDocument()
    await fetchStatus()

    // Stop polling if stuck — user can manually retry
    if (isStuck.value) {
      stopPolling()
      return
    }

    if (doc.value && !['pending', 'processing'].includes(doc.value.processing_status)) {
      stopPolling()
      await Promise.all([fetchCategories(), fetchDedupInfo()])
      const status = doc.value.processing_status
      if (status === 'completed' || status === 'flagged_for_review') {
        toast.add({ title: 'Processing complete', color: 'success' })
      } else if (status === 'failed') {
        toast.add({ title: 'Processing failed', description: doc.value.processing_error, color: 'error' })
      }
    }
  }, 3000)
}

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

const reprocess = async () => {
  reprocessing.value = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await $fetch(`/api/documents/${documentId}/reprocess`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    toast.add({ title: 'Reprocessing started — this may take a minute', color: 'info' })
    await fetchDocument()
    startPolling()
  } catch (err: any) {
    toast.add({ title: 'Reprocess failed', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    reprocessing.value = false
  }
}

const deleteDocument = async () => {
  deleting.value = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await $fetch(`/api/documents/${documentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    deleteModalOpen.value = false
    toast.add({ title: 'Document deleted', color: 'success' })
    navigateTo('/documents')
  } catch (err: any) {
    toast.add({ title: 'Delete failed', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    deleting.value = false
  }
}

const downloadLoading = ref(false)

async function confirmSharePublication(action: 'publish_shared' | 'keep_private') {
  confirmShareLoading.value = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await $fetch(`/api/documents/${documentId}/confirm-share`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body: { action },
    })
    toast.add({
      title: action === 'publish_shared' ? 'Document is now shared with all members' : 'Left as private',
      color: 'success',
    })
    await fetchDocument()
  } catch (err: any) {
    toast.add({
      title: 'Could not update visibility',
      description: err.data?.statusMessage ?? err.data?.message ?? err.message,
      color: 'error',
    })
  } finally {
    confirmShareLoading.value = false
  }
}

const download = async () => {
  if (!doc.value?.file_url) return
  downloadLoading.value = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const result = await $fetch<{ url: string }>(`/api/documents/${documentId}/download`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    const a = document.createElement('a')
    a.href = result.url
    a.target = '_blank'
    a.click()
  } catch (err: any) {
    toast.add({ title: 'Download failed', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    downloadLoading.value = false
  }
}

// Admin: override sensitivity tier
const tierOverrideOptions = [
  { label: 'Scheme Ops', value: 'scheme_ops' },
  { label: 'Personal Financial', value: 'personal_financial' },
  { label: 'Privileged Legal', value: 'privileged_legal' },
]

const privacyOverrideOptions = [
  { label: 'Shared', value: 'shared' },
  { label: 'Private', value: 'private' },
  { label: 'Privileged', value: 'privileged' },
]

const privacyLabels: Record<string, string> = {
  shared: 'Shared',
  private: 'Private',
  privileged: 'Privileged',
}

const overridePrivacy = async (newLevel: string) => {
  try {
    const { error } = await supabase
      .from('documents')
      .update({ privacy_level: newLevel })
      .eq('id', documentId)

    if (error) throw error
    doc.value.privacy_level = newLevel
    toast.add({ title: `Privacy level updated to "${privacyLabels[newLevel]}"`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Failed to update privacy level', description: err.message, color: 'error' })
  }
}

const overrideTier = async (newTier: string) => {
  try {
    const { error } = await supabase
      .from('documents')
      .update({ sensitivity_tier: newTier })
      .eq('id', documentId)

    if (error) throw error
    doc.value.sensitivity_tier = newTier
    toast.add({ title: `Sensitivity tier updated to "${sensitivityLabels[newTier]}"`, color: 'success' })
  } catch (err: any) {
    toast.add({ title: 'Failed to update tier', description: err.message, color: 'error' })
  }
}

onMounted(async () => {
  // Ensure profile is loaded (plugin fires async, may not be ready yet)
  if (!profile.value) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (data && !error) {
        profile.value = data as any
      }
    }
  }
  await Promise.all([fetchDocument(), fetchCategories(), fetchStatus(), fetchDedupInfo()])
  loading.value = false

  // Start polling if document is still processing
  if (doc.value && ['pending', 'processing'].includes(doc.value.processing_status)) {
    startPolling()
  }
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="max-w-4xl">
    <!-- Header -->
    <div class="flex items-center gap-2 mb-6">
      <UButton
        icon="i-heroicons-arrow-left"
        variant="ghost"
        size="sm"
        to="/documents"
      />
      <div v-if="!loading && doc" class="flex-1 min-w-0">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white truncate">
          {{ doc.title || doc.original_filename || 'Untitled' }}
        </h1>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
    </div>

    <div v-else-if="doc" class="space-y-6">
      <!-- Duplicate banner -->
      <div
        v-if="isDuplicate"
        class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4"
      >
        <div class="flex items-start gap-3">
          <UIcon name="i-heroicons-document-duplicate" class="w-5 h-5 text-amber-500 mt-0.5" />
          <div class="flex-1">
            <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
              This is a copy of an existing document
            </p>
            <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Detected as {{ dedupStatusLabels[doc.dedup_status] || doc.dedup_status }}.
              Processing results were copied from the original — no additional API costs incurred.
            </p>
            <NuxtLink
              v-if="canonicalDoc"
              :to="`/documents/${canonicalDoc.id}`"
              class="inline-flex items-center gap-1 mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              <UIcon name="i-heroicons-arrow-right" class="w-3.5 h-3.5" />
              View original: {{ canonicalDoc.title || 'Untitled' }}
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Copies list (shown on canonical documents) -->
      <div
        v-if="isCanonical"
        class="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4"
      >
        <div class="flex items-start gap-3">
          <UIcon name="i-heroicons-document-duplicate" class="w-5 h-5 text-blue-500 mt-0.5" />
          <div class="flex-1">
            <p class="text-sm font-medium text-blue-800 dark:text-blue-200">
              {{ documentCopies.length }} {{ documentCopies.length === 1 ? 'copy' : 'copies' }} of this document
            </p>
            <div class="mt-2 space-y-1">
              <NuxtLink
                v-for="copy in documentCopies"
                :key="copy.id"
                :to="`/documents/${copy.id}`"
                class="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300 hover:underline"
              >
                <UIcon name="i-heroicons-document" class="w-3.5 h-3.5" />
                {{ copy.title || 'Untitled' }}
                <span class="text-xs text-blue-500 dark:text-blue-400">
                  {{ new Date(copy.created_at).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' }) }}
                </span>
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>

      <!-- Email share@ — sender confirms scheme-wide visibility -->
      <div
        v-if="showEmailShareConfirm"
        class="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4"
      >
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div class="min-w-0">
            <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
              You sent this to the shared archive address
            </p>
            <p class="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
              Automated review could not confirm it is suitable for <strong>all</strong> members. It stays
              <strong>private</strong> until you choose. If you publish it as shared, other signed-in members will be able
              to see it (subject to normal access rules). Only proceed if you are comfortable with that.
            </p>
            <p v-if="doc.ai_privacy_reason" class="text-xs text-amber-700/90 dark:text-amber-400/90 mt-2 italic">
              Note: {{ doc.ai_privacy_reason }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2 shrink-0">
            <UButton
              label="Publish as shared"
              color="warning"
              variant="solid"
              size="sm"
              :loading="confirmShareLoading"
              @click="confirmSharePublication('publish_shared')"
            />
            <UButton
              label="Keep private"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="confirmShareLoading"
              @click="confirmSharePublication('keep_private')"
            />
          </div>
        </div>
      </div>

      <!-- Metadata card -->
      <UCard>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Privacy</span>
            <div class="flex items-center gap-2">
              <UBadge :color="privacyColors[doc.privacy_level]" variant="soft">
                {{ doc.privacy_level }}
              </UBadge>
              <USelect
                v-if="isAdmin"
                :model-value="doc.privacy_level"
                :items="privacyOverrideOptions"
                value-key="value"
                size="xs"
                class="w-32"
                @update:model-value="overridePrivacy"
              />
            </div>
            <p v-if="doc.ai_privacy_reason" class="text-xs text-gray-400 dark:text-gray-500 mt-1 italic">
              {{ doc.ai_privacy_reason }}
            </p>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Sensitivity</span>
            <div class="flex items-center gap-2">
              <UBadge
                :color="sensitivityColors[doc.sensitivity_tier] ?? 'neutral'"
                variant="soft"
              >
                {{ sensitivityLabels[doc.sensitivity_tier] ?? doc.sensitivity_tier }}
              </UBadge>
              <!-- Admin tier override -->
              <USelect
                v-if="isAdmin"
                :model-value="doc.sensitivity_tier"
                :items="tierOverrideOptions"
                value-key="value"
                size="xs"
                class="w-40"
                @update:model-value="overrideTier"
              />
            </div>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Status</span>
            <UBadge :color="statusColors[doc.processing_status] ?? 'neutral'" variant="soft">
              {{ doc.processing_status?.replace(/_/g, ' ') }}
            </UBadge>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Type</span>
            <span class="text-gray-900 dark:text-white">{{ doc.doc_type || '—' }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Document date</span>
            <span class="text-gray-900 dark:text-white">{{ formatDate(doc.doc_date) }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Uploaded</span>
            <span class="text-gray-900 dark:text-white">{{ formatDateTime(doc.created_at) }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">File</span>
            <span class="text-gray-900 dark:text-white text-xs">{{ doc.original_filename }}</span>
          </div>
        </div>

        <template #footer>
          <div class="flex gap-2">
            <UButton
              v-if="canDownload"
              icon="i-heroicons-arrow-down-tray"
              label="Download"
              variant="outline"
              size="sm"
              :loading="downloadLoading"
              @click="download"
            />
            <span
              v-else-if="doc.file_url"
              :title="downloadDisabledReason"
              class="inline-flex"
            >
              <UButton
                icon="i-heroicons-arrow-down-tray"
                label="Download"
                variant="outline"
                size="sm"
                disabled
              />
            </span>
            <UButton
              v-if="isAdmin"
              icon="i-heroicons-arrow-path"
              label="Reprocess"
              variant="outline"
              size="sm"
              :loading="reprocessing"
              @click="reprocess"
            />
            <UButton
              v-if="isAdmin || isSubmitter"
              icon="i-heroicons-trash"
              label="Delete"
              variant="outline"
              color="error"
              size="sm"
              @click="deleteModalOpen = true"
            />
          </div>
        </template>
      </UCard>

      <!-- Email source metadata -->
      <UCard v-if="doc.email_context">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-envelope" class="w-4 h-4 text-gray-500" />
            <span class="font-medium text-gray-900 dark:text-white">Email Source</span>
          </div>
        </template>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div v-if="doc.email_context.sender_email">
            <span class="text-gray-500 dark:text-gray-400 block mb-0.5">From</span>
            <span class="text-gray-900 dark:text-white">
              {{ doc.email_context.sender_name ? `${doc.email_context.sender_name} <${doc.email_context.sender_email}>` : doc.email_context.sender_email }}
            </span>
          </div>
          <div v-if="doc.email_context.subject">
            <span class="text-gray-500 dark:text-gray-400 block mb-0.5">Subject</span>
            <span class="text-gray-900 dark:text-white">{{ doc.email_context.subject }}</span>
          </div>
          <div v-if="doc.email_context.received_at">
            <span class="text-gray-500 dark:text-gray-400 block mb-0.5">Received</span>
            <span class="text-gray-900 dark:text-white">{{ formatDateTime(doc.email_context.received_at) }}</span>
          </div>
          <div v-if="doc.email_context.body_stored_as_document && doc.email_context.body_document_id">
            <span class="text-gray-500 dark:text-gray-400 block mb-0.5">Email body</span>
            <NuxtLink
              :to="`/documents/${doc.email_context.body_document_id}`"
              class="text-primary-500 hover:text-primary-600 underline"
            >
              Stored as separate document
            </NuxtLink>
          </div>
        </div>
        <div v-if="doc.email_context.body_snippet && !doc.email_context.body_stored_as_document" class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <span class="text-gray-500 dark:text-gray-400 text-xs block mb-1">Email body preview</span>
          <p class="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap line-clamp-4">{{ doc.email_context.body_snippet }}</p>
        </div>
      </UCard>

      <!-- Processing status (shown while processing or on failure) -->
      <UCard v-if="['pending', 'processing'].includes(doc.processing_status)">
        <div v-if="isStuck" class="flex items-start gap-3 mb-4">
          <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-500 mt-0.5" />
          <div class="flex-1">
            <p class="font-medium text-red-800 dark:text-red-200">Document appears stuck</p>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Processing has not progressed for an extended period.
              <span v-if="doc.retry_count > 0">Retried {{ doc.retry_count }} time{{ doc.retry_count > 1 ? 's' : '' }}.</span>
              <span v-if="doc.retry_count >= 3"> Maximum retries reached — consider uploading a different format.</span>
            </p>
            <UButton
              v-if="isAdmin && doc.retry_count < 3"
              icon="i-heroicons-arrow-path"
              label="Retry now"
              size="sm"
              variant="outline"
              class="mt-2"
              :loading="reprocessing"
              @click="reprocess"
            />
          </div>
        </div>
        <div v-else class="flex items-center gap-3 mb-4">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 text-primary-500 animate-spin" />
          <span class="font-medium text-gray-900 dark:text-white">Processing document...</span>
        </div>
        <div v-if="processingStages.length" class="space-y-3">
          <div v-for="stage in processingStages" :key="stage.stage" class="text-sm">
            <div class="flex items-center gap-2 mb-1">
              <UIcon
                :name="stageIcons[stage.stage] ?? 'i-heroicons-cog-6-tooth'"
                class="w-4 h-4 shrink-0"
                :class="{
                  'text-yellow-500 animate-spin': stage.status === 'running',
                  'text-green-500': stage.status === 'completed',
                  'text-red-500': stage.status === 'failed',
                  'text-gray-400': stage.status === 'pending',
                }"
              />
              <span class="text-gray-900 dark:text-white font-medium">
                {{ stageLabels[stage.stage] ?? stage.stage.replace(/_/g, ' ') }}
              </span>
              <UBadge :color="stageStatusColors[stage.status] ?? 'neutral'" variant="soft" size="xs">
                {{ stage.status }}
              </UBadge>
              <span v-if="stage.started_at" class="text-gray-400 text-xs ml-auto tabular-nums">
                {{ formatElapsed(stage.started_at, stage.completed_at) }}
              </span>
            </div>
            <!-- Detail text -->
            <p
              v-if="stage.detail && stage.status === 'running'"
              class="text-xs text-gray-500 dark:text-gray-400 ml-6"
            >
              {{ stage.detail }}
            </p>
            <!-- Progress bar for running stages -->
            <div
              v-if="stage.status === 'running' && stage.progress > 0"
              class="ml-6 mt-1"
            >
              <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary-500 rounded-full transition-all duration-500"
                  :style="{ width: `${stage.progress}%` }"
                />
              </div>
            </div>
            <!-- Error message -->
            <p v-if="stage.error_message" class="text-xs text-red-500 ml-6 mt-1 truncate">
              {{ stage.error_message }}
            </p>
          </div>
        </div>
      </UCard>

      <!-- Error display -->
      <UCard v-if="doc.processing_error && doc.processing_status === 'failed'" class="border-red-200 dark:border-red-800">
        <div class="flex items-start gap-3">
          <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-500 mt-0.5" />
          <div>
            <p class="font-medium text-red-800 dark:text-red-200 mb-1">Processing failed</p>
            <p class="text-sm text-red-600 dark:text-red-400">{{ doc.processing_error }}</p>
          </div>
        </div>
      </UCard>

      <!-- AI Summary -->
      <UCard v-if="doc.ai_summary">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium text-gray-900 dark:text-white">AI Summary</span>
            <UBadge v-if="doc.ai_confidence" variant="soft" size="xs">
              {{ (doc.ai_confidence * 100).toFixed(0) }}% confidence
            </UBadge>
          </div>
        </template>
        <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{{ doc.ai_summary }}</p>
      </UCard>

      <!-- Categories -->
      <UCard v-if="categories.length > 0">
        <template #header>
          <span class="font-medium text-gray-900 dark:text-white">Categories</span>
        </template>
        <div class="flex flex-wrap gap-2">
          <UBadge
            v-for="cat in categories"
            :key="cat.category?.id"
            variant="soft"
            color="primary"
          >
            {{ cat.category?.name }}
            <span v-if="cat.confidence" class="ml-1 opacity-60">{{ (cat.confidence * 100).toFixed(0) }}%</span>
          </UBadge>
        </div>
      </UCard>

      <!-- Delete confirmation modal -->
      <UModal v-model:open="deleteModalOpen">
        <template #content>
          <div class="p-6">
            <div class="flex items-start gap-3 mb-4">
              <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 text-red-500 mt-0.5" />
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Delete document</h3>
                <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Are you sure? This will permanently delete the document and its file. This action cannot be undone.
                </p>
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <UButton
                label="Cancel"
                variant="outline"
                @click="deleteModalOpen = false"
              />
              <UButton
                label="Delete"
                color="error"
                icon="i-heroicons-trash"
                :loading="deleting"
                @click="deleteDocument"
              />
            </div>
          </div>
        </template>
      </UModal>

      <!-- Extracted/Scrubbed text -->
      <UCard v-if="hasText">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium text-gray-900 dark:text-white">Document text</span>
            <div v-if="canToggleText">
              <div class="inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  class="px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                  :class="textView === 'scrubbed'
                    ? 'bg-primary-500 text-white'
                    : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
                  @click="textView = 'scrubbed'"
                >
                  Scrubbed
                </button>
                <button
                  class="px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer border-l border-gray-200 dark:border-gray-700"
                  :class="textView === 'original'
                    ? 'bg-primary-500 text-white'
                    : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
                  @click="textView = 'original'"
                >
                  Original
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- Scrub notice -->
        <div
          v-if="scrubNotice && textView !== 'original'"
          class="mb-3 text-xs px-3 py-2 rounded-md"
          :class="isSubmitter
            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'"
        >
          {{ scrubNotice }}
        </div>

        <div class="max-h-96 overflow-y-auto">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <pre class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed" v-html="highlightedText" />
        </div>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
:deep(.redacted-marker) {
  background-color: rgb(34 197 94 / 0.2);
  border-radius: 2px;
  padding: 1px 3px;
}
</style>
