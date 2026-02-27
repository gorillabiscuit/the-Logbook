<script setup lang="ts">
const { profile, signOut } = useAuth()

const navLinks = [
  { label: 'Dashboard', icon: 'i-heroicons-home', to: '/' },
  { label: 'Documents', icon: 'i-heroicons-document-text', to: '/documents' },
  { label: 'Chat', icon: 'i-heroicons-chat-bubble-left-right', to: '/chat' },
  { label: 'Issues', icon: 'i-heroicons-exclamation-triangle', to: '/issues' },
  { label: 'Notices', icon: 'i-heroicons-bell', to: '/notices' },
  { label: 'Contractors', icon: 'i-heroicons-wrench-screwdriver', to: '/contractors' },
  { label: 'Timeline', icon: 'i-heroicons-calendar-days', to: '/timeline' },
]

const adminLinks = [
  { label: 'Users', icon: 'i-heroicons-users', to: '/admin/users' },
  { label: 'Categories', icon: 'i-heroicons-tag', to: '/admin/categories' },
  { label: 'Flagged', icon: 'i-heroicons-flag', to: '/admin/flagged' },
  { label: 'Entities', icon: 'i-heroicons-share', to: '/admin/entities' },
]

const isAdmin = computed(() =>
  profile.value?.role === 'super_admin' || profile.value?.role === 'trustee'
)

const sidebarOpen = ref(false)
</script>

<template>
  <div class="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
    <!-- Mobile overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-20 bg-black/50 lg:hidden"
      @click="sidebarOpen = false"
    />

    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-30 flex flex-col w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <!-- Logo -->
      <div class="flex items-center gap-3 px-4 py-5 border-b border-gray-200 dark:border-gray-800">
        <div class="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <UIcon name="i-heroicons-book-open" class="text-white w-5 h-5" />
        </div>
        <div class="min-w-0">
          <div class="font-semibold text-gray-900 dark:text-white text-sm leading-tight">The Logbook</div>
          <div class="text-xs text-gray-500 dark:text-gray-400 truncate">Yacht Club BC</div>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        <UButton
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          :icon="link.icon"
          :label="link.label"
          variant="ghost"
          color="neutral"
          class="w-full justify-start"
          @click="sidebarOpen = false"
        />

        <div v-if="isAdmin" class="pt-4">
          <div class="px-3 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Admin
          </div>
          <UButton
            v-for="link in adminLinks"
            :key="link.to"
            :to="link.to"
            :icon="link.icon"
            :label="link.label"
            variant="ghost"
            color="neutral"
            class="w-full justify-start"
            @click="sidebarOpen = false"
          />
        </div>
      </nav>

      <!-- User section -->
      <div class="px-3 py-4 border-t border-gray-200 dark:border-gray-800">
        <div v-if="profile" class="flex items-center gap-3 mb-2 px-2">
          <UAvatar
            :alt="profile.full_name"
            size="sm"
          />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ profile.full_name }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
              {{ profile.unit_number ? `Unit ${profile.unit_number}` : profile.role }}
            </div>
          </div>
        </div>
        <UButton
          label="Sign out"
          icon="i-heroicons-arrow-right-on-rectangle"
          variant="ghost"
          color="neutral"
          size="sm"
          class="w-full justify-start"
          @click="signOut"
        />
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Mobile header -->
      <header class="lg:hidden flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <UButton
          icon="i-heroicons-bars-3"
          variant="ghost"
          color="neutral"
          @click="sidebarOpen = true"
        />
        <span class="font-semibold text-gray-900 dark:text-white">The Logbook</span>
      </header>

      <!-- Page content -->
      <main class="flex-1 overflow-y-auto">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
