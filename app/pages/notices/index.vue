<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { isAdmin } = useAuth()
const toast = useToast()

const notices = ref<any[]>([])
const loading = ref(true)
const showForm = ref(false)

const noticeTypes = [
  { label: 'General', value: 'general' },
  { label: 'Maintenance', value: 'maintenance' },
  { label: 'AGM', value: 'agm' },
  { label: 'Urgent', value: 'urgent' },
  { label: 'Event', value: 'event' },
]

const form = reactive({
  title: '',
  content: '',
  notice_type: 'general',
  is_pinned: false,
  expires_at: '',
})

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchNotices() {
  loading.value = true
  try {
    notices.value = await $fetch('/api/notices')
  } catch { /* empty */ } finally {
    loading.value = false
  }
}

async function createNotice() {
  if (!form.title.trim() || !form.content.trim()) return
  try {
    const headers = await getAuthHeaders()
    await $fetch('/api/notices', {
      method: 'POST',
      headers,
      body: { ...form, expires_at: form.expires_at || null },
    })
    toast.add({ title: 'Notice published', color: 'success' })
    showForm.value = false
    form.title = ''
    form.content = ''
    form.notice_type = 'general'
    form.is_pinned = false
    form.expires_at = ''
    await fetchNotices()
  } catch (err: any) {
    toast.add({ title: 'Failed to publish', description: err?.data?.message || err.message, color: 'error' })
  }
}

async function deleteNotice(id: string) {
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/notices/${id}`, { method: 'DELETE', headers })
    toast.add({ title: 'Notice deleted', color: 'success' })
    await fetchNotices()
  } catch (err: any) {
    toast.add({ title: 'Failed to delete', description: err?.data?.message || err.message, color: 'error' })
  }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}

const typeColor: Record<string, string> = {
  general: 'neutral',
  maintenance: 'warning',
  agm: 'primary',
  urgent: 'error',
  event: 'success',
}

onMounted(fetchNotices)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Notice Board</h1>
        <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">Building notices and announcements</p>
      </div>
      <UButton
        v-if="isAdmin"
        icon="i-heroicons-plus"
        label="New notice"
        @click="showForm = !showForm"
      />
    </div>

    <!-- Create form -->
    <UCard v-if="showForm && isAdmin" class="mb-6">
      <form @submit.prevent="createNotice" class="space-y-4">
        <UFormField label="Title" required>
          <UInput v-model="form.title" placeholder="Notice title" class="w-full" />
        </UFormField>
        <UFormField label="Content" required>
          <UTextarea v-model="form.content" placeholder="Notice content..." :rows="4" class="w-full" />
        </UFormField>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Type">
            <USelect v-model="form.notice_type" :items="noticeTypes" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Expires">
            <UInput v-model="form.expires_at" type="date" class="w-full" />
          </UFormField>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="form.is_pinned" class="rounded text-primary-600" />
          Pin to top
        </label>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" variant="ghost" @click="showForm = false" />
          <UButton type="submit" label="Publish" />
        </div>
      </form>
    </UCard>

    <!-- Notices list -->
    <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>
    <div v-else-if="notices.length === 0" class="text-center py-16">
      <UIcon name="i-heroicons-bell" class="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <p class="text-sm text-gray-400">No notices yet</p>
    </div>
    <div v-else class="space-y-4">
      <UCard v-for="notice in notices" :key="notice.id">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1">
              <UIcon v-if="notice.is_pinned" name="i-heroicons-bookmark-solid" class="w-4 h-4 text-primary-500 flex-shrink-0" />
              <h3 class="text-base font-semibold text-gray-900 dark:text-white truncate">{{ notice.title }}</h3>
              <UBadge :color="typeColor[notice.notice_type] || 'neutral'" variant="subtle" size="xs">
                {{ notice.notice_type }}
              </UBadge>
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{{ notice.content }}</p>
            <div class="flex items-center gap-3 mt-3 text-xs text-gray-400">
              <span>{{ notice.profiles?.full_name || 'Unknown' }}</span>
              <span>{{ formatDate(notice.created_at) }}</span>
              <span v-if="notice.expires_at">Expires {{ formatDate(notice.expires_at) }}</span>
            </div>
          </div>
          <UButton
            v-if="isAdmin"
            icon="i-heroicons-trash"
            variant="ghost"
            color="error"
            size="xs"
            @click="deleteNotice(notice.id)"
          />
        </div>
      </UCard>
    </div>
  </div>
</template>
