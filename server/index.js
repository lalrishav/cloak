const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { WebSocketServer } = require('ws')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
}

let httpServer = null
let wss = null
let currentToken = null
let cmdHandler = null
let statusHandler = null
const clients = new Set()

function getLocalIp() {
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve(port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '0.0.0.0')
  })
}

async function start({ onCommand, onConnectionChange }) {
  currentToken = crypto.randomBytes(8).toString('hex')
  cmdHandler = onCommand || (() => {})
  statusHandler = onConnectionChange || (() => {})

  const publicDir = path.join(__dirname, 'public')

  httpServer = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://localhost')
      let pathname = reqUrl.pathname

      // Token is required only on the entry URL (root) and on the WS upgrade.
      // Static assets (CSS, JS, images) referenced from the loaded HTML are
      // requested without the query string, so we serve them unauthenticated.
      // Commands still flow exclusively over the token-gated WebSocket.
      if (pathname === '/' || pathname === '') {
        const token = reqUrl.searchParams.get('t')
        if (!token || token !== currentToken) {
          res.statusCode = 401
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end('Unauthorized — invalid or missing remote token. Re-scan the QR.')
          return
        }
        pathname = '/index.html'
      }

      const filePath = path.normalize(path.join(publicDir, pathname))
      if (!filePath.startsWith(publicDir)) {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(filePath).pipe(res)
      })
    } catch {
      res.statusCode = 500
      res.end('Server error')
    }
  })

  let port = null
  for (let p = 7000; p < 7100; p++) {
    try {
      await tryListen(httpServer, p)
      port = p
      break
    } catch {
      // try next port
    }
  }
  if (port == null) throw new Error('Could not bind any port between 7000 and 7099')

  wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const reqUrl = new URL(req.url, 'http://localhost')
      const token = reqUrl.searchParams.get('t')
      if (!token || token !== currentToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } catch {
      socket.destroy()
    }
  })

  wss.on('connection', (ws) => {
    clients.add(ws)
    statusHandler(clients.size)

    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(String(data))
      } catch {
        return
      }
      if (msg && typeof msg.cmd === 'string') {
        cmdHandler(msg, ws)
      }
    })

    const cleanup = () => {
      clients.delete(ws)
      statusHandler(clients.size)
    }
    ws.on('close', cleanup)
    ws.on('error', cleanup)
  })

  const ip = getLocalIp()
  const url = `http://${ip}:${port}/?t=${currentToken}`
  return { url, ip, port, token: currentToken }
}

function broadcast(msg) {
  if (!clients.size) return
  const data = JSON.stringify(msg)
  for (const c of clients) {
    if (c.readyState === 1) {
      try { c.send(data) } catch { /* ignore */ }
    }
  }
}

function sendTo(ws, msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)) } catch { /* ignore */ }
  }
}

function getConnectionCount() {
  return clients.size
}

function stop() {
  for (const c of clients) {
    try { c.close() } catch { /* ignore */ }
  }
  clients.clear()
  if (wss) {
    try { wss.close() } catch { /* ignore */ }
    wss = null
  }
  if (httpServer) {
    try { httpServer.close() } catch { /* ignore */ }
    httpServer = null
  }
}

module.exports = { start, stop, broadcast, sendTo, getConnectionCount }
