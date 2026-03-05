// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  modules: ['@nuxt/ui', '@nuxtjs/supabase', '@vueuse/nuxt'],

  nitro: {
    vercel: {
      functions: {
        maxDuration: 300,
      },
    },
  },

  supabase: {
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: ['/login', '/consent'],
    },
    types: '~/types/database.types.ts',
  },

  runtimeConfig: {
    supabaseServiceRoleKey: process.env.SUPABASE_SECRET_KEY || '',
    anthropicApiKey: '',
    embeddingApiKey: '',
    meilisearchApiKey: '',
    emailWebhookSecret: '',
    cronSecret: '',
    unstructuredApiKey: '',
    unstructuredApiUrl: '',
    googleClientId: '',
    googleClientSecret: '',
    public: {
      meilisearchHost: '',
      appUrl: '',
    },
  },
})
