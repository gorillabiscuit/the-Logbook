// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  modules: ['@nuxt/ui', '@nuxtjs/supabase', '@vueuse/nuxt'],

  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login', '/consent'],
    },
    types: '~/types/database.types.ts',
  },

  runtimeConfig: {
    supabaseServiceRoleKey: '',
    anthropicApiKey: '',
    embeddingApiKey: '',
    meilisearchApiKey: '',
    emailWebhookSecret: '',
    unstructuredApiKey: '',
    unstructuredApiUrl: '',
    public: {
      meilisearchHost: '',
    },
  },
})
