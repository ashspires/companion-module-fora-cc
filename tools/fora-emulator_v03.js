/**
 * FORA-1010 Device Emulator
 * 
 * Emulates the HTTP API of a FOR-A FA-1010 colour corrector.
 * Supports 5 channels (fs=0 to fs=4).
 * 
 * Endpoints:
 *   GET  /video_param.cgi?fs=N   -> returns current parameter values for channel N
 *   POST /post_video.cgi?fs=N    -> updates a single parameter for channel N
 * 
 * Usage:
 *   node fora-emulator.js
 * 
 * Then set the FORA-1010 module IP to: localhost (port 3000)
 */

const http = require('http')
const PORT = 3000

// ─── Parameter definitions (mirrors ACTIONS in module) ──────────────────────
// [jsonField, scale, min, max, default]
// Values stored internally at protocol scale (x10 for floats)
const PARAM_DEFS = {
  proc_vlvl:  { json: 'videoLevel',      scale: 10, min: 0,    max: 2000, def: 1000 },
  proc_ylvl:  { json: 'lumLevel',        scale: 10, min: 0,    max: 2000, def: 1000 },
  proc_clvl:  { json: 'chromaLevel',     scale: 10, min: 0,    max: 2000, def: 1000 },
  proc_blvl:  { json: 'blackLevel',      scale: 10, min: -200, max: 1000, def: 0    },
  proc_hue:   { json: 'hue',             scale: 10, min: -899, max: 900,  def: 0    },
  cc_wlvlr:   { json: 'whiteLevelRed',   scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_wlvlg:   { json: 'whiteLevelGreen', scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_wlvlb:   { json: 'whiteLevelBlue',  scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_blvlr:   { json: 'blackLevelRed',   scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_blvlg:   { json: 'blackLevelGreen', scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_blvlb:   { json: 'blackLevelBlue',  scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_glvlr:   { json: 'gammaLevelRed',   scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_glvlg:   { json: 'gammaLevelGreen', scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_glvlb:   { json: 'gammaLevelBlue',  scale: 10, min: 0,    max: 2000, def: 1000 },
  cc_curve:   { json: 'gammaCurve',      scale: 1,  min: 0,    max: 2,    def: 0    },
  proc_byp:   { json: 'procBypass',      scale: 1,  min: 0,    max: 1,    def: 0    },
  cc_mode:    { json: 'ccMode',          scale: 1,  min: 0,    max: 1,    def: 0    },
}

// Map URL-encoded POST keys to param keys
// e.g. proc%3Avlvl -> proc_vlvl, cc%3Awlvlr -> cc_wlvlr
const POST_KEY_MAP = {
  'proc%3Avlvl': 'proc_vlvl',
  'proc%3Aylvl': 'proc_ylvl',
  'proc%3Aclvl': 'proc_clvl',
  'proc%3Ablvl': 'proc_blvl',
  'proc%3Ahue':  'proc_hue',
  'cc%3Awlvlr':  'cc_wlvlr',
  'cc%3Awlvlg':  'cc_wlvlg',
  'cc%3Awlvlb':  'cc_wlvlb',
  'cc%3Ablvlr':  'cc_blvlr',
  'cc%3Ablvlg':  'cc_blvlg',
  'cc%3Ablvlb':  'cc_blvlb',
  'cc%3Aglvlr':  'cc_glvlr',
  'cc%3Aglvlg':  'cc_glvlg',
  'cc%3Aglvlb':  'cc_glvlb',
  'cc%3Acurve':  'cc_curve',
  'proc%3Abyp':  'proc_byp',
  'cc%3Amode':   'cc_mode',
}

// ─── State: 5 channels (fs=0 to fs=4) ───────────────────────────────────────
// Initialize all channels with default values
const state = {}
for (let fs = 0; fs <= 4; fs++) {
  state[fs] = {}
  for (const [key, def] of Object.entries(PARAM_DEFS)) {
    state[fs][key] = def.def
  }
}

// Give each channel slightly different starting values so you can
// tell them apart when testing
state[0].proc_vlvl = 1000  // Ch1: all defaults
state[1].proc_vlvl = 1100  // Ch2: video level 110.0
state[1].cc_wlvlr  = 1050  // Ch2: white red 105.0
state[2].proc_vlvl = 950   // Ch3: video level 95.0
state[2].proc_blvl = 50    // Ch3: black level 5.0
state[3].proc_vlvl = 1200  // Ch4: video level 120.0
state[3].cc_curve  = 1     // Ch4: gamma curve Black
state[4].proc_vlvl = 800   // Ch5: video level 80.0
state[4].proc_byp  = 1     // Ch5: bypass on

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 23)
}

function log(method, path, status, extra) {
  const tag = status >= 400 ? '❌' : '✅'
  console.log(`[${timestamp()}] ${tag}  ${method.padEnd(4)} ${path.padEnd(35)} → ${status}${extra ? '  ' + extra : ''}`)
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

function sendError(res, status, message) {
  sendJSON(res, status, { status: false, error: message })
}

// Build the JSON response for a channel (mirrors real device format)
function buildChannelResponse(fs) {
  const ch = state[fs]
  return {
    videoLevel:      ch.proc_vlvl / PARAM_DEFS.proc_vlvl.scale,
    lumLevel:        ch.proc_ylvl / PARAM_DEFS.proc_ylvl.scale,
    chromaLevel:     ch.proc_clvl / PARAM_DEFS.proc_clvl.scale,
    blackLevel:      ch.proc_blvl / PARAM_DEFS.proc_blvl.scale,
    hue:             ch.proc_hue  / PARAM_DEFS.proc_hue.scale,
    ccMode:          ch.cc_mode,
    whiteLevelRed:   ch.cc_wlvlr  / PARAM_DEFS.cc_wlvlr.scale,
    whiteLevelGreen: ch.cc_wlvlg  / PARAM_DEFS.cc_wlvlg.scale,
    whiteLevelBlue:  ch.cc_wlvlb  / PARAM_DEFS.cc_wlvlb.scale,
    blackLevelRed:   ch.cc_blvlr  / PARAM_DEFS.cc_blvlr.scale,
    blackLevelGreen: ch.cc_blvlg  / PARAM_DEFS.cc_blvlg.scale,
    blackLevelBlue:  ch.cc_blvlb  / PARAM_DEFS.cc_blvlb.scale,
    gammaLevelRed:   ch.cc_glvlr  / PARAM_DEFS.cc_glvlr.scale,
    gammaLevelGreen: ch.cc_glvlg  / PARAM_DEFS.cc_glvlg.scale,
    gammaLevelBlue:  ch.cc_glvlb  / PARAM_DEFS.cc_glvlb.scale,
    gammaCurve:      ch.cc_curve,
    sepiaLevel:      25.0,
    sepiaColor:      -160.0,
    procBypass:      ch.proc_byp,
    bypass: [
      { enable: true, data: 0 },
      { enable: true, data: 0 },
      { enable: true, data: 0 },
      { enable: true, data: 0 },
      { enable: true, data: 0 },
      { enable: true, data: 0 },
    ],
    end: ''
  }
}

// Print a table of all current channel values
function printStateTable() {
  const COL = 8  // width of each value column (excluding borders)
  const header = '─'.repeat(COL)
  const top    = `┌─────────────────────────┬${[header,header,header,header,header].join('┬')}┐`
  const mid    = `├─────────────────────────┼${[header,header,header,header,header].join('┼')}┤`
  const bot    = `└─────────────────────────┴${[header,header,header,header,header].join('┴')}┘`
  const hdrs   = [' Ch 1 ',' Ch 2 ',' Ch 3 ',' Ch 4 ',' Ch 5 '].map(h => h.padEnd(COL))
  console.log('')
  console.log(top)
  console.log(`│ ${'Parameter'.padEnd(23)} │${hdrs.join('│')}│`)
  console.log(mid)
  for (const [key, def] of Object.entries(PARAM_DEFS)) {
    const label = def.json.padEnd(23)
    const cells = [0,1,2,3,4].map(fs => {
      const v   = state[fs][key] / def.scale
      const fmt = def.scale === 1 ? String(v) : v.toFixed(1)
      return fmt.padStart(COL - 1) + ' '  // right-align value, 1 space padding right
    })
    console.log(`│ ${label} │${cells.join('│')}│`)
  }
  console.log(bot)
  console.log('')
}

// ─── Request handler ──────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const urlParts = req.url.split('?')
  const urlPath  = urlParts[0]
  const query    = new URLSearchParams(urlParts[1] || '')
  const method   = req.method.toUpperCase()

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  // ── GET /video_param.cgi?fs=N ─────────────────────────────────────────────
  if (method === 'GET' && urlPath === '/video_param.cgi') {
    const fs = parseInt(query.get('fs') ?? '0', 10)
    if (fs < 0 || fs > 4 || isNaN(fs)) {
      log(method, req.url, 400, `Invalid fs=${query.get('fs')}`)
      sendError(res, 400, `Invalid fs parameter: ${query.get('fs')} (must be 0-4)`)
      return
    }
    const response = buildChannelResponse(fs)
    log(method, req.url, 200, `ch${fs+1} vlvl=${state[fs].proc_vlvl}`)
    sendJSON(res, 200, response)
    return
  }

  // ── POST /post_video.cgi?fs=N ─────────────────────────────────────────────
  if (method === 'POST' && urlPath === '/post_video.cgi') {
    const fs = parseInt(query.get('fs') ?? '0', 10)
    if (fs < 0 || fs > 4 || isNaN(fs)) {
      log(method, req.url, 400, `Invalid fs=${query.get('fs')}`)
      sendError(res, 400, `Invalid fs parameter: ${query.get('fs')} (must be 0-4)`)
      return
    }

    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      // Log raw request
      console.log(`[${timestamp()}] 📥 POST ch${fs+1} body="${body}" (${body.length} bytes) hex=${Buffer.from(body).toString('hex')}`)

      // Parse body: expects format like "proc%3Avlvl=1000" or "proc:vlvl=1000"
      // Split on = to get key and value
      const eqIndex = body.indexOf('=')
      if (eqIndex === -1) {
        log(method, req.url, 400, `Bad body format: "${body}"`)
        sendError(res, 400, `Bad body format: expected "key=value", got "${body}"`)
        return
      }

      const rawKey   = body.substring(0, eqIndex).trim()
      const rawValue = body.substring(eqIndex + 1).trim()

      // Look up param key — try both encoded and decoded forms
      const paramKey = POST_KEY_MAP[rawKey] || POST_KEY_MAP[encodeURIComponent(decodeURIComponent(rawKey))]
      if (!paramKey) {
        log(method, req.url, 400, `Unknown param key: "${rawKey}"`)
        sendError(res, 400, `Unknown parameter key: "${rawKey}"`)
        return
      }

      const def   = PARAM_DEFS[paramKey]
      const value = parseInt(rawValue, 10)
      if (isNaN(value)) {
        log(method, req.url, 400, `Bad value: "${rawValue}"`)
        sendError(res, 400, `Value must be an integer, got "${rawValue}"`)
        return
      }

      // Clamp to valid range
      const clamped = Math.min(def.max, Math.max(def.min, value))
      if (clamped !== value) {
        console.log(`[${timestamp()}] ⚠️  Value ${value} clamped to ${clamped} (range ${def.min}-${def.max})`)
      }

      // Store and respond
      state[fs][paramKey] = clamped
      const displayValue = clamped / def.scale
      log(method, req.url, 200, `ch${fs+1} ${def.json}=${displayValue}`)
      sendJSON(res, 200, { status: true })
    })
    return
  }

  // ── Unknown endpoint ───────────────────────────────────────────────────────
  log(method, req.url, 404)
  sendError(res, 404, `Unknown endpoint: ${urlPath}`)
})

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('')
  console.log('┌──────────────────────────────────────────────────────────────┐')
  console.log('│              FORA-1010 Device Emulator                       │')
  console.log('├──────────────────────────────────────────────────────────────┤')
  console.log(`│  Listening on  http://localhost:${PORT}                           │`)
  console.log('├──────────────────────────────────────────────────────────────┤')
  console.log('│  GET  /video_param.cgi?fs=N   read channel N (0-4)           │')
  console.log('│  POST /post_video.cgi?fs=N    write single param to channel N│')
  console.log('├──────────────────────────────────────────────────────────────┤')
  console.log('│  In Companion module config set:                             │')
  console.log('│    Host: localhost                                            │')
  console.log('│    Port: 3000                                                 │')
  console.log('└──────────────────────────────────────────────────────────────┘')
  console.log('')
  console.log('Initial channel values:')
  printStateTable()
  console.log('Waiting for requests...')
  console.log('')
})

// Print state table every 30 seconds so you can see current values
setInterval(printStateTable, 30000)

// Also print on SIGINT before exit
process.on('SIGINT', () => {
  console.log('\nFinal state:')
  printStateTable()
  process.exit(0)
})
