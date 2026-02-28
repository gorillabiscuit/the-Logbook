<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const toast = useToast()
const router = useRouter()

const chatText = ref('')
const title = ref('')
const privacyLevel = ref('shared')
const importing = ref(false)
const importResult = ref<any>(null)

const privacyOptions = [
  { label: 'Shared', value: 'shared' },
  { label: 'Private', value: 'private' },
  { label: 'Privileged', value: 'privileged' },
]

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    chatText.value = e.target?.result as string || ''
    if (!title.value) {
      title.value = file.name.replace(/\.[^.]+$/, '')
    }
  }
  reader.readAsText(file)
}

async function importChat() {
  if (!chatText.value.trim()) {
    toast.add({ title: 'Please paste or upload a WhatsApp export', color: 'warning' })
    return
  }

  importing.value = true
  try {
    const headers = await getAuthHeaders()
    const result = await $fetch<any>('/api/documents/import-whatsapp', {
      method: 'POST',
      headers,
      body: {
        content: chatText.value,
        title: title.value || undefined,
        privacy_level: privacyLevel.value,
      },
    })

    importResult.value = result
    toast.add({
      title: 'WhatsApp chat imported',
      description: `${result.messageCount} messages from ${result.participants.length} participants`,
      color: 'success',
    })
  } catch (err: any) {
    toast.add({ title: 'Import failed', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    importing.value = false
  }
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center gap-2 mb-6">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" size="sm" to="/documents" />
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Import WhatsApp Chat</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Import an exported WhatsApp conversation as a searchable document
        </p>
      </div>
    </div>

    <!-- Success result -->
    <UCard v-if="importResult" class="mb-6">
      <div class="text-center py-4">
        <UIcon name="i-heroicons-check-circle" class="w-10 h-10 text-green-500 mx-auto mb-3" />
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Import successful</h2>
        <div class="text-sm text-gray-500 space-y-1">
          <p>{{ importResult.messageCount }} messages imported</p>
          <p>Participants: {{ importResult.participants.join(', ') }}</p>
          <p>Date range: {{ formatDate(importResult.dateRange?.start) }} — {{ formatDate(importResult.dateRange?.end) }}</p>
        </div>
        <div class="flex justify-center gap-3 mt-4">
          <UButton :to="`/documents/${importResult.documentId}`" label="View document" />
          <UButton label="Import another" variant="ghost" @click="importResult = null; chatText = ''; title = ''" />
        </div>
      </div>
    </UCard>

    <!-- Import form -->
    <UCard v-else>
      <div class="space-y-5">
        <div class="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">How to export a WhatsApp chat</h3>
          <ol class="text-xs text-blue-800 dark:text-blue-300 space-y-1 list-decimal list-inside">
            <li>Open the WhatsApp chat you want to export</li>
            <li>Tap the three dots (menu) → More → Export chat</li>
            <li>Select "Without media"</li>
            <li>Save the .txt file and upload it below, or paste the contents</li>
          </ol>
        </div>

        <!-- File upload -->
        <UFormField label="Upload .txt file">
          <div
            class="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-4 text-center hover:border-primary-400 transition-colors cursor-pointer"
            @click="($refs.fileInput as HTMLInputElement).click()"
          >
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              accept=".txt"
              @click.stop
              @change="onFileChange"
            />
            <UIcon name="i-heroicons-document-text" class="w-6 h-6 text-gray-400 mx-auto mb-1" />
            <p class="text-sm text-gray-500">Click to upload a WhatsApp export file</p>
          </div>
        </UFormField>

        <div class="text-center text-xs text-gray-400">— or paste the chat text below —</div>

        <!-- Text input -->
        <UFormField label="Chat text">
          <UTextarea
            v-model="chatText"
            placeholder="Paste your WhatsApp chat export here..."
            :rows="10"
            class="w-full font-mono text-xs"
          />
        </UFormField>

        <div v-if="chatText" class="text-xs text-gray-500">
          {{ chatText.split('\n').length }} lines pasted
        </div>

        <UFormField label="Title (optional)">
          <UInput v-model="title" placeholder="Auto-generated from participants" class="w-full" />
        </UFormField>

        <UFormField label="Privacy level">
          <USelect v-model="privacyLevel" :items="privacyOptions" value-key="value" class="w-full" />
        </UFormField>

        <div class="flex justify-end gap-3">
          <UButton label="Cancel" variant="ghost" to="/documents" />
          <UButton
            label="Import chat"
            icon="i-heroicons-arrow-down-tray"
            :loading="importing"
            :disabled="!chatText.trim()"
            @click="importChat"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
