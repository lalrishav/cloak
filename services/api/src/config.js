'use strict'

// Reads configuration from the environment with safe local-dev defaults.
// Pass an explicit env object in tests.
function loadConfig(env = process.env) {
  const port = Number(env.PORT || 8787)
  return {
    port,
    host: env.HOST || '0.0.0.0',
    mongoUri: env.CLOAK_CLOUD_MONGO_URI || 'mongodb://127.0.0.1:27017',
    mongoDb: env.CLOAK_CLOUD_MONGO_DB || 'cloak_cloud',
    downloadBaseUrl: (env.CUE_DOWNLOAD_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    adminUser: env.CUE_ADMIN_USER || 'admin',
    adminPass: env.CUE_ADMIN_PASS || 'change-me-locally',
    sessionSecret: env.CUE_SESSION_SECRET || 'dev-only-secret-change-me',
    adminOrigin: (env.CUE_ADMIN_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // AI proxy keys — live ONLY here, never shipped in the desktop binary.
    openaiApiKey: env.OPENAI_API_KEY || '',
    deepgramApiKey: env.DEEPGRAM_API_KEY || '',
    isDev: (env.NODE_ENV || 'development') !== 'production'
  }
}

module.exports = { loadConfig }
