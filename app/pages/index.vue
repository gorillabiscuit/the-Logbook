<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const { profile } = useAuth()
const supabase = useSupabaseClient()

const stats = ref({
  documents: 0,
  issues: 0,
  openIssues: 0,
  notices: 0,
})

onMounted(async () => {
  const [docs, issues, openIssues, notices] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase.from('issues').select('id', { count: 'exact', head: true }),
    supabase.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('notices').select('id', { count: 'exact', head: true }),
  ])

  stats.value = {
    documents: docs.count ?? 0,
    issues: issues.count ?? 0,
    openIssues: openIssues.count ?? 0,
    notices: notices.count ?? 0,
  }
})

const quickLinks = [
  { label: 'Upload a document', icon: 'i-heroicons-arrow-up-tray', to: '/documents/upload', color: 'primary' as const },
  { label: 'Browse documents', icon: 'i-heroicons-document-text', to: '/documents', color: 'neutral' as const },
  { label: 'Report an issue', icon: 'i-heroicons-exclamation-triangle', to: '/issues/new', color: 'warning' as const },
  { label: 'Ask the AI', icon: 'i-heroicons-chat-bubble-left-right', to: '/chat', color: 'success' as const },
]
</script>

<template>
  <div>
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
        Welcome back{{ profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : '' }}
      </h1>
      <p class="text-gray-500 dark:text-gray-400 mt-1">
        The Yacht Club Residential Body Corporate — Collective Knowledge Platform
      </p>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <UCard>
        <div class="text-center">
          <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ stats.documents }}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Documents</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ stats.openIssues }}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Open Issues</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ stats.issues }}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Total Issues</div>
        </div>
      </UCard>
      <UCard>
        <div class="text-center">
          <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ stats.notices }}</div>
          <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Notices</div>
        </div>
      </UCard>
    </div>

    <!-- Quick links -->
    <div class="mb-8">
      <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-3">Quick actions</h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <UButton
          v-for="link in quickLinks"
          :key="link.to"
          :to="link.to"
          :icon="link.icon"
          :label="link.label"
          :color="link.color"
          variant="soft"
          class="justify-start h-auto py-3"
        />
      </div>
    </div>

    <!-- Placeholder for recent activity -->
    <div>
      <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-3">Recent activity</h2>
      <UCard>
        <div class="text-center py-8 text-gray-400 dark:text-gray-500">
          <UIcon name="i-heroicons-clock" class="w-8 h-8 mx-auto mb-2" />
          <p class="text-sm">Recent activity will appear here as documents and issues are added.</p>
        </div>
      </UCard>
    </div>
  </div>
</template>
