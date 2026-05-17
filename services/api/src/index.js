'use strict'
require('dotenv').config()

const { loadConfig } = require('./config')
const db = require('./db')
const { buildServer } = require('./server')

// Keep retrying Mongo in the background so the API self-heals once mongod is up.
async function retryConnect(config) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000))
    const s = await db.connect({ uri: config.mongoUri, dbName: config.mongoDb })
    if (s.connected) {
      console.log('[cue-api] MongoDB connected (after retry):', s.dbName)
      return
    }
  }
}

async function main() {
  const config = loadConfig()

  const status = await db.connect({ uri: config.mongoUri, dbName: config.mongoDb })
  if (status.connected) {
    console.log('[cue-api] MongoDB connected:', status.dbName)
  } else {
    console.error('[cue-api] WARNING: MongoDB not connected —', status.error)
    console.error(
      '[cue-api] Start a local mongod (mongodb://127.0.0.1:27017); endpoints return 503 until then.'
    )
    retryConnect(config)
  }

  const app = await buildServer({ db, config })
  try {
    await app.listen({ port: config.port, host: config.host })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
