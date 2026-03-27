// TurtleShell.ai Off-Grid — Node Dashboard
// Serves at localhost:6160
// CloudPremise LLC — brain/1.7.x.x

const express = require('express')
const http = require('http')
const fs = require('fs')
const path = require('path')
const QRCode = require('qrcode')
const https = require('https')
const os = require('os')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 717

// ── API PROXY — TLS termination for /v1/* fleet traffic ────
// MUST be mounted BEFORE express.json() so request body isn't consumed.
// The offgrid dashboard is the HTTPS endpoint. Ares runs plain HTTP.
// This proxy lets clients reach the full fleet via https://{host}:717/v1/*
const ARES_PORT = 3451
app.use('/v1', (req, res) => {
  const aresHost = fs.existsSync('/.dockerenv') ? 'host.docker.internal' : 'localhost'
  const options = {
    hostname: aresHost,
    port: ARES_PORT,
    path: '/v1' + req.url,
    method: req.method,
    headers: { ...req.headers, host: `${aresHost}:${ARES_PORT}` },
    timeout: 120000,
  }
  delete options.headers['sec-fetch-mode']
  delete options.headers['sec-fetch-site']

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })
  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'Fleet proxy failed', detail: err.message }))
  })
  proxyReq.on('timeout', () => {
    proxyReq.destroy()
    if (!res.headersSent) res.writeHead(504, { 'Content-Type': 'application/json' })
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'Fleet proxy timeout' }))
  })
  req.pipe(proxyReq)
})

app.use(express.json())

// ── FLEET SERVICES ─────────────────────────────────────────
const SERVICES = [
  { name: 'Aeon',        role: 'Long-term Memory',  port: 3581, icon: '♾️' },
  { name: 'Alpha',       role: 'Feature Flags',     port: 3621, icon: 'α' },
  { name: 'Aphrodite',   role: 'Design System',     port: 3471, icon: '💎' },
  { name: 'Apollo',      role: 'Voice Engine',       port: 3421, icon: '☀️' },
  { name: 'Ares',        role: 'API Gateway',       port: 3451, icon: '⚔️' },
  { name: 'Argos',       role: 'Observability',     port: 3521, icon: '👁️' },
  { name: 'Artemis',     role: 'Security',          port: 3611, icon: '🏹' },
  { name: 'Athena',      role: 'LLM Router',        port: 3401, icon: '🦉' },
  { name: 'Chronos',     role: 'Time Services',     port: 3571, icon: '⏱️' },
  { name: 'Delphi',      role: 'Analytics',         port: 3721, icon: '📊' },
  { name: 'Demeter',     role: 'Data Harvest',      port: 3591, icon: '🌾' },
  { name: 'Dionysus',    role: 'Media',             port: 3601, icon: '🎭' },
  { name: 'Eos',         role: 'Scheduling',        port: 3531, icon: '🌅' },
  { name: 'Hades',       role: 'Archive',           port: 3641, icon: '💀' },
  { name: 'Hecate',      role: 'Identity & Crypto', port: 3651, icon: '🔮' },
  { name: 'Hephaestus',  role: 'Build Forge',       port: 3511, icon: '🔨' },
  { name: 'Hera',        role: 'Auth Gateway',      port: 3491, icon: '👑' },
  { name: 'Hermes',      role: 'CORS Proxy',        port: 3411, icon: '✉️' },
  { name: 'Hestia',      role: 'Home Services',     port: 3501, icon: '🏠' },
  { name: 'Iris',        role: 'Service Desk',      port: 3541, icon: '🌈' },
  { name: 'Mnemosyne',   role: 'Episodic Memory',   port: 3711, icon: '🧠' },
  { name: 'Omega',       role: 'Shutdown Manager',  port: 3731, icon: 'Ω' },
  { name: 'Oracle',      role: 'Predictions',       port: 3661, icon: '🏛️' },
  { name: 'Orion',       role: 'Search',            port: 3561, icon: '⭐' },
  { name: 'Plutus',      role: 'Billing',           port: 3701, icon: '💰' },
  { name: 'Poseidon',    role: 'MCP Tools',         port: 3431, icon: '🔱' },
  { name: 'Prometheus',  role: 'Agentic Jobs',      port: 3741, icon: '🔥' },
  { name: 'Proteus',     role: 'Universal ORM',     port: 3461, icon: '🔄' },
  { name: 'TurtleShell.ai Off-Grid', role: 'Dashboard', port: 717, icon: '🐢' },
  { name: 'Zeus',        role: 'Fleet Controller',  port: 3481, icon: '⚡' },
]

// ── HELPERS ────────────────────────────────────────────────
// In Docker, use host.docker.internal to reach other containers' published ports
const FLEET_HOST = process.env.FLEET_HOST || (fs.existsSync('/.dockerenv') ? 'host.docker.internal' : 'localhost')

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: FLEET_HOST, port, path: '/health', timeout: 3000 },
      (res) => {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => {
          try { resolve({ status: res.statusCode === 200 ? 'healthy' : 'degraded', data: JSON.parse(body) }) }
          catch { resolve({ status: res.statusCode === 200 ? 'healthy' : 'degraded', data: body }) }
        })
      }
    )
    req.on('error', () => resolve({ status: 'offline', data: null }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 'offline', data: null }) })
  })
}

function fetchJSON(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: FLEET_HOST, port, path, timeout: 5000 },
      (res) => {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => {
          try { resolve(JSON.parse(body)) } catch { resolve(body) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function getNodeInfo() {
  try {
    const home = process.env.HOME || '/root'
    return JSON.parse(fs.readFileSync(path.join(home, '.turtleshell', 'manifest.json'), 'utf8'))
  } catch {
    return { node_name: 'TurtleShell Node', node_id: 'unknown', version: '1.7.0', architecture: 'unknown' }
  }
}

const HOME = process.env.HOME || os.homedir()
const CERT_DIR = path.join(HOME, '.turtleshell', 'certs')

function getLocalIPs() {
  // Prefer NODE_PRIMARY_IP from env (set by installer, passed by docker-compose)
  const primaryIP = process.env.NODE_PRIMARY_IP
  if (primaryIP && primaryIP !== 'localhost') {
    return [primaryIP]
  }
  // Fallback to network interface scan
  const ifs = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(ifs)) {
    for (const iface of ifs[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('172.')) {
        ips.push(iface.address)
      }
    }
  }
  return ips.length > 0 ? ips : ['localhost']
}

// ── SHARED LAYOUT ──────────────────────────────────────────
const NAV = [
  { path: '/nodestatus',   label: 'Node Status',   icon: '📡' },
  { path: '/chat',         label: 'Chat',         icon: '💬' },
  { path: '/history',      label: 'History',       icon: '📜' },
  { path: '/memory',       label: 'Memory',        icon: '🧠' },
  { path: '/services',     label: 'Services',      icon: '🔌' },
  { path: '/service-desk', label: 'Service Desk',  icon: '🛟' },
  { path: '/agents',       label: 'Agents',        icon: '🤖' },
  { path: '/docs',         label: 'Docs',          icon: '📖' },
  { path: '/settings',     label: 'Settings',      icon: '⚙️' },
]

function layout(activePath, title, content, extraHead = '') {
  const node = getNodeInfo()
  const navItems = NAV.map(n => `
    <a href="${n.path}" class="nav-item ${activePath === n.path ? 'active' : ''}">
      <span class="nav-icon">${n.icon}</span>
      <span class="nav-label">${n.label}</span>
    </a>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} — TurtleShell.ai Off-Grid</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#0a0a0b;color:#fafafa;font-family:'DM Sans',-apple-system,sans-serif;height:100%;overflow:hidden}
a{color:#4ade80;text-decoration:none}
a:hover{text-decoration:underline}
code,.mono{font-family:'JetBrains Mono',monospace}
.shell{display:flex;height:100vh;overflow:hidden}

/* Sidebar */
.sidebar{width:240px;background:#111113;border-right:1px solid #1a1a1d;display:flex;flex-direction:column;flex-shrink:0}
.sidebar-hdr{height:56px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #1a1a1d;gap:10px}
.sidebar-hdr .logo{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#22c55e,#4ade80);display:flex;align-items:center;justify-content:center;font-size:14px}
.sidebar-hdr .brand{font-size:14px;font-weight:700;color:#fafafa;white-space:nowrap}
.sidebar-hdr .brand em{color:#4ade80;font-style:normal}
.sidebar-hdr .tag{font-size:9px;color:#22c55e;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);padding:2px 6px;border-radius:3px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.sidebar-nav{flex:1;padding:12px 8px;overflow-y:auto}
.nav-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;font-size:13px;color:#a1a1aa;cursor:pointer;text-decoration:none;margin-bottom:2px}
.nav-item:hover{background:#1a1a1d;color:#fafafa;text-decoration:none}
.nav-item.active{background:#232326;color:#fafafa}
.nav-icon{width:18px;text-align:center;font-size:14px}
.sidebar-foot{padding:12px 16px;border-top:1px solid #1a1a1d;font-size:11px;color:#52525b}

/* Main */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.topbar{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid #1a1a1d;background:rgba(10,10,11,.8);backdrop-filter:blur(12px);flex-shrink:0}
.topbar h2{font-size:15px;font-weight:600}
.content{flex:1;overflow-y:auto;padding:24px}

/* Cards */
.card{background:#111113;border:1px solid #1a1a1d;border-radius:12px;overflow:hidden}
.card-hdr{padding:14px 16px;border-bottom:1px solid #1a1a1d;display:flex;align-items:center;justify-content:space-between}
.card-hdr h3{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#a1a1aa}
.card-body{padding:16px}

/* Badge */
.badge{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600}
.badge-green{background:rgba(74,222,128,.1);color:#4ade80;border:1px solid rgba(74,222,128,.2)}
.badge-yellow{background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.2)}
.badge-red{background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.2)}
.badge-gray{background:rgba(113,113,122,.1);color:#71717a;border:1px solid rgba(113,113,122,.2)}

/* Buttons */
.btn{padding:8px 16px;border-radius:8px;border:1px solid #1a1a1d;background:#111113;color:#fafafa;font-size:13px;cursor:pointer;font-family:inherit;transition:background .15s}
.btn:hover{background:#1a1a1d}
.btn-primary{background:#22c55e;color:#fff;border-color:#22c55e}
.btn-primary:hover{background:#16a34a}

/* Forms */
input,textarea,select{background:#0a0a0b;border:1px solid #1a1a1d;border-radius:8px;padding:10px 12px;color:#fafafa;font-family:inherit;font-size:13px;width:100%;outline:none}
input:focus,textarea:focus{border-color:#22c55e}
textarea{resize:vertical}
select{cursor:pointer}

/* Modal */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.modal-overlay.open{display:flex}
.modal{background:#111113;border:1px solid #1a1a1d;border-radius:12px;max-width:560px;width:90%;max-height:80vh;overflow-y:auto;padding:24px}
.modal h3{font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
.modal pre{background:#0a0a0b;border:1px solid #1a1a1d;border-radius:8px;padding:16px;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:#a1a1aa}

/* Dot */
.dot{width:6px;height:6px;border-radius:50%;display:inline-block}
.dot-green{background:#4ade80}
.dot-yellow{background:#fbbf24}
.dot-gray{background:#3f3f46}
.dot-red{background:#ef4444}

/* Service row */
.svc-row{display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid #1a1a1d;gap:12px;cursor:pointer;transition:background .1s}
.svc-row:hover{background:#0a0a0b}
.svc-row:last-child{border-bottom:none}
.svc-row.offline{background:rgba(239,68,68,.04);border-left:3px solid #ef4444}
.svc-row.offline:hover{background:rgba(239,68,68,.08)}
.svc-row.offline .svc-name{color:#fca5a5}
.svc-row.degraded{background:rgba(251,191,36,.04);border-left:3px solid #fbbf24}
.svc-row.degraded:hover{background:rgba(251,191,36,.08)}
.svc-icon{width:22px;text-align:center;font-size:15px}
.svc-name{flex:1;font-weight:600;font-size:13px}
.svc-role{color:#71717a;font-size:12px;min-width:120px}
.svc-port{color:#52525b;font-family:'JetBrains Mono',monospace;font-size:11px;min-width:48px}
.svc-status{display:flex;align-items:center;gap:6px;min-width:80px;justify-content:flex-end}
.svc-status span{font-size:11px;font-weight:500}

/* Chat */
.chat-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden}
.chat-messages{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px}
.msg{max-width:80%;padding:12px 16px;border-radius:12px;font-size:13px;line-height:1.6;animation:fadeIn .3s ease-out}
.msg-user{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.2);align-self:flex-end}
.msg-assistant{background:#111113;border:1px solid #1a1a1d;align-self:flex-start}
.msg-role{font-size:10px;color:#71717a;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px}
.chat-input-wrap{padding:16px 24px;border-top:1px solid #1a1a1d;display:flex;gap:12px;align-items:flex-end;background:#0a0a0b}
.chat-input-wrap textarea{min-height:44px;max-height:200px;flex:1}
.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#52525b}
.empty-state .emoji{font-size:48px}
.empty-state p{font-size:14px}

/* Grid */
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}

/* Section */
.section-hdr{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#71717a;margin:24px 0 12px;padding:0 4px}
.section-hdr:first-child{margin-top:0}

/* Misc */
.muted{color:#71717a}
.text-sm{font-size:12px}
.mt-4{margin-top:16px}
.mb-4{margin-bottom:16px}
.p-4{padding:16px}
.gap-3{gap:12px}
.flex{display:flex}
.items-center{align-items:center}
.justify-between{justify-content:space-between}
.cursor-pointer{cursor:pointer}

@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.streaming-cursor{display:inline-block;width:2px;height:14px;background:#4ade80;animation:pulse 1.4s infinite ease-in-out;margin-left:2px;vertical-align:text-bottom}

@media(max-width:768px){.sidebar{display:none}}
</style>
${extraHead}
</head>
<body>
<div class="shell">
  <div class="sidebar">
    <div class="sidebar-hdr">
      <div class="logo">🐢</div>
      <div>
        <div class="brand">TurtleShell<em>.ai</em></div>
        <div class="tag">Off-Grid</div>
      </div>
    </div>
    <div class="sidebar-nav">${navItems}</div>
    <div class="sidebar-foot">
      ${node.node_name} &middot; v${node.version || '1.7.0'}<br/>
      CloudPremise LLC
    </div>
  </div>
  <div class="main">
    <div class="topbar">
      <h2 id="pageTitle">${title}</h2>
      <div id="sovereignUrl" style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:#71717a;white-space:nowrap">Your Sovereign AI</span>
        <code id="athenaUrl" style="font-size:13px;font-weight:700;color:#4ade80;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);padding:4px 12px;border-radius:6px;cursor:pointer;white-space:nowrap" onclick="copyUrl()" title="Click to copy"></code>
        <span id="copyMsg" style="font-size:10px;color:#4ade80;opacity:0;transition:opacity .3s">Copied!</span>
        <div id="qrToggle" onclick="toggleQR()" style="width:28px;height:28px;border:1px solid rgba(34,197,94,.2);border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;background:rgba(34,197,94,.08)" title="Show QR code">⊞</div>
      </div>
      <div id="qrPanel" style="display:none;position:absolute;top:56px;right:24px;background:#111113;border:1px solid #1a1a1d;border-radius:12px;padding:20px;z-index:50;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:11px;color:#71717a;margin-bottom:12px;letter-spacing:1px;text-transform:uppercase">Scan with TurtleShell.ai iOS</div>
        <div id="qrImage" style="width:160px;height:160px;margin:0 auto 12px"></div>
        <div id="qrUrl" style="font-size:11px;color:#4ade80;font-family:'JetBrains Mono',monospace"></div>
      </div>
      <script>
      (function(){
        var h=location.hostname||'localhost';
        var proto=location.protocol==='https:'?'https':'http';
        var url=proto+'://'+h+':'+location.port+'/v1/athena';
        document.getElementById('athenaUrl').textContent=url;
        document.getElementById('qrUrl').textContent=url;
        fetch('/api/qr?host='+h).then(r=>r.text()).then(svg=>{
          document.getElementById('qrImage').innerHTML=svg;
        });
      })();
      function copyUrl(){
        navigator.clipboard.writeText(document.getElementById('athenaUrl').textContent);
        var m=document.getElementById('copyMsg');m.style.opacity='1';setTimeout(function(){m.style.opacity='0'},1500);
      }
      var qrOpen=false;
      function toggleQR(){
        qrOpen=!qrOpen;
        document.getElementById('qrPanel').style.display=qrOpen?'block':'none';
      }
      document.addEventListener('click',function(e){
        if(qrOpen&&!e.target.closest('#qrPanel')&&!e.target.closest('#qrToggle')){
          qrOpen=false;document.getElementById('qrPanel').style.display='none';
        }
      });
      </script>
    </div>
    ${content}
  </div>
</div>
</body>
</html>`
}

// ── API ROUTES ─────────────────────────────────────────────

// QR code endpoint — generates SVG QR for the node connection URL
app.get('/api/qr', async (req, res) => {
  const host = req.query.host || req.hostname || 'localhost'
  const httpsEnabled = fs.existsSync(path.join(CERT_DIR, 'node-cert.pem'))
  const scheme = httpsEnabled ? 'https' : 'http'
  const url = `${scheme}://${host}:${PORT}/v1/athena`
  try {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      color: { dark: '#4ade80', light: '#00000000' },
      margin: 0,
      width: 160,
    })
    res.type('svg').send(svg)
  } catch (e) {
    res.status(500).send('QR generation failed')
  }
})

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'turtleshell-offgrid', port: PORT })
})

// Service health detail (for modal)
app.get('/api/service/:port', async (req, res) => {
  const port = parseInt(req.params.port)
  try {
    const result = await ping(port)
    // Also try /status endpoint for more detail
    let statusData = null
    try { statusData = await fetchJSON(port, '/status') } catch {}
    res.json({ ...result, statusData, port })
  } catch (e) {
    res.json({ status: 'offline', data: null, error: e.message, port })
  }
})

// Fleet status API
app.get('/api/fleet', async (req, res) => {
  const results = await Promise.all(
    SERVICES.map(async (s) => ({ ...s, ...(await ping(s.port)) }))
  )
  res.json({ node: getNodeInfo(), services: results })
})

// Chat proxy — streams from Athena
app.post('/api/chat', (req, res) => {
  const { prompt, conversationId } = req.body
  const payload = JSON.stringify({
    prompt,
    shell_id: 'offgrid-default',
    tenant_id: 'offgrid',
    conversationId: conversationId || undefined,
    memoryEnabled: true,
    saveConversation: true,
  })

  const options = {
    hostname: FLEET_HOST,
    port: 3401,
    path: '/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    timeout: 60000,
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const proxy = http.request(options, (upstream) => {
    upstream.pipe(res)
    upstream.on('end', () => res.end())
  })

  proxy.on('error', (e) => {
    res.write(`data: {"error":"Athena unreachable: ${e.message}"}\n\n`)
    res.end()
  })

  proxy.write(payload)
  proxy.end()
})

// Memory API proxy
app.get('/api/memory', async (req, res) => {
  try {
    const data = await fetchJSON(3711, '/api/memory/reflect?agentId=athena&shellId=offgrid-default&tenantId=offgrid')
    res.json(data)
  } catch (e) {
    res.json({ memories: [], error: e.message })
  }
})

// History API proxy
app.get('/api/history', async (req, res) => {
  try {
    const data = await fetchJSON(3711, '/api/conversation/saved?shellId=offgrid-default&tenantId=offgrid')
    res.json(data)
  } catch (e) {
    res.json({ conversations: [], error: e.message })
  }
})

// ── PAGE ROUTES ────────────────────────────────────────────

// Redirect root
app.get('/', (req, res) => res.redirect('/nodestatus'))

// Status endpoint (machine-readable, like other services)
app.get('/status', (req, res) => {
  const node = getNodeInfo()
  res.json({
    service: 'turtleshell-offgrid',
    status: 'online',
    version: node.version || '1.7.0',
    node_id: node.node_id,
    node_name: node.node_name,
    architecture: node.architecture,
    platform: node.platform || 'macos',
    port: PORT,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  })
})

// ── NODE STATUS PAGE ───────────────────────────────────────
app.get('/nodestatus', async (req, res) => {
  const node = getNodeInfo()
  const raw = await Promise.all(
    SERVICES.map(async (s) => ({ ...s, ...(await ping(s.port)) }))
  )
  // Sort: unhealthy first (alphabetical), then healthy (alphabetical)
  const results = [
    ...raw.filter(s => s.status !== 'healthy').sort((a, b) => a.name.localeCompare(b.name)),
    ...raw.filter(s => s.status === 'healthy').sort((a, b) => a.name.localeCompare(b.name)),
  ]
  const healthyCount = results.filter(s => s.status === 'healthy').length
  const allHealthy = healthyCount === results.length
  const overallColor = allHealthy ? '#4ade80' : healthyCount > 0 ? '#fbbf24' : '#ef4444'
  const overallLabel = allHealthy ? 'All Systems Operational' : `${healthyCount}/${results.length} Online`
  const overallBadge = allHealthy ? 'badge-green' : healthyCount > 0 ? 'badge-yellow' : 'badge-red'

  const serviceRows = results.map(s => {
    const dotClass = s.status === 'healthy' ? 'dot-green' : s.status === 'degraded' ? 'dot-yellow' : 'dot-gray'
    const color = s.status === 'healthy' ? '#4ade80' : s.status === 'degraded' ? '#fbbf24' : '#52525b'
    const rowClass = s.status === 'offline' ? 'offline' : s.status === 'degraded' ? 'degraded' : ''
    return `<div class="svc-row ${rowClass}" onclick="showDetail(${s.port},'${s.name}','${s.icon}')">
      <span class="svc-icon">${s.icon}</span>
      <span class="svc-name">${s.name}</span>
      <span class="svc-role">${s.role}</span>
      <span class="svc-port">:${s.port}</span>
      <span class="svc-status"><span class="dot ${dotClass}"></span><span style="color:${color}">${s.status === 'healthy' ? 'Healthy' : s.status === 'degraded' ? 'Degraded' : 'Offline'}</span></span>
    </div>`
  }).join('')

  const content = `
    <div class="content">
      <div class="card mb-4" style="border-top:2px solid ${overallColor}">
        <div style="padding:20px 24px;display:flex;align-items:center;gap:16px">
          <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#22c55e,#4ade80);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🐢</div>
          <div style="flex:1">
            <div style="font-size:16px;font-weight:700">${node.node_name || 'TurtleShell Node'}</div>
            <div class="text-sm muted">ID: ${String(node.node_id || '').slice(0,8)} &middot; ${node.architecture || 'arm64'} &middot; v${node.version || '1.7.0'}</div>
          </div>
          <div style="display:flex;gap:24px;text-align:center">
            <div><div style="font-size:20px;font-weight:700;color:#4ade80">${healthyCount}</div><div style="font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:1px">Healthy</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#52525b">${results.length - healthyCount}</div><div style="font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:1px">Offline</div></div>
          </div>
          <span class="badge ${overallBadge}"><span class="dot ${allHealthy ? 'dot-green' : 'dot-yellow'}"></span>${overallLabel}</span>
        </div>
      </div>
      <div class="card">
        <div class="card-hdr"><h3>Fleet Services</h3><span class="muted text-sm">${results.length} services &middot; auto-refreshes</span></div>
        ${serviceRows}
      </div>
      <div style="text-align:center;padding:16px;font-size:11px;color:#52525b">Click any service to view details &middot; Refreshes every 10 seconds</div>
    </div>
    <div class="modal-overlay" id="detailModal" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3><span id="modalTitle"></span><span onclick="closeModal()" style="cursor:pointer;color:#71717a;font-size:18px">&times;</span></h3>
        <div id="modalBody"><div class="muted">Loading...</div></div>
      </div>
    </div>`

  const extraHead = `
    <meta http-equiv="refresh" content="10"/>
    <script>
    function showDetail(port,name,icon){
      document.getElementById('detailModal').classList.add('open');
      document.getElementById('modalTitle').textContent=icon+' '+name+' — :'+port;
      document.getElementById('modalBody').innerHTML='<div class="muted">Loading...</div>';
      fetch('/api/service/'+port).then(r=>r.json()).then(d=>{
        let html='<div class="mb-4"><span class="badge '+(d.status==='healthy'?'badge-green':d.status==='degraded'?'badge-yellow':'badge-gray')+'"><span class="dot '+(d.status==='healthy'?'dot-green':'dot-gray')+'"></span>'+d.status+'</span></div>';
        if(d.data) html+='<div class="section-hdr">/health</div><pre>'+JSON.stringify(d.data,null,2)+'</pre>';
        if(d.statusData) html+='<div class="section-hdr mt-4">/status</div><pre>'+JSON.stringify(d.statusData,null,2)+'</pre>';
        if(!d.data&&!d.statusData) html+='<div class="muted mt-4">Service is not responding.</div>';
        document.getElementById('modalBody').innerHTML=html;
      }).catch(()=>{
        document.getElementById('modalBody').innerHTML='<div class="muted">Failed to fetch service details.</div>';
      });
    }
    function closeModal(){document.getElementById('detailModal').classList.remove('open')}
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
    </script>`

  const titleHtml = `Node Status <span class="badge ${overallBadge}" style="margin-left:12px;font-size:11px"><span class="dot ${allHealthy ? 'dot-green' : healthyCount > 0 ? 'dot-yellow' : 'dot-red'}"></span>${overallLabel}</span>`
  res.send(layout('/nodestatus', titleHtml, content, extraHead))
})

// ── CHAT PAGE ──────────────────────────────────────────────
app.get('/chat', (req, res) => {
  const content = `
    <div class="chat-wrap">
      <div class="chat-messages" id="messages">
        <div class="empty-state" id="emptyState">
          <div class="emoji">🐢</div>
          <p>Message Athena to begin</p>
          <p class="text-sm muted">Your sovereign AI &middot; running locally</p>
        </div>
      </div>
      <div class="chat-input-wrap">
        <textarea id="chatInput" rows="1" placeholder="Message Athena..." onkeydown="handleKey(event)" oninput="autoGrow(this)"></textarea>
        <button class="btn btn-primary" id="sendBtn" onclick="sendMessage()">Send</button>
      </div>
    </div>`

  const extraHead = `<script>
  let conversationId = null;
  let isStreaming = false;
  const msgs = document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('chatInput').focus();
  });

  function autoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px'}

  function handleKey(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}
  }

  function addMessage(role,content){
    const el=document.getElementById('emptyState');if(el)el.remove();
    const d=document.createElement('div');
    d.className='msg msg-'+role;
    d.innerHTML='<div class="msg-role">'+role+'</div><div class="msg-content">'+escapeHtml(content)+'</div>';
    document.getElementById('messages').appendChild(d);
    d.scrollIntoView({behavior:'smooth'});
    return d;
  }

  function escapeHtml(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

  async function sendMessage(){
    if(isStreaming)return;
    const input=document.getElementById('chatInput');
    const prompt=input.value.trim();
    if(!prompt)return;
    input.value='';input.style.height='auto';
    addMessage('user',prompt);

    isStreaming=true;
    document.getElementById('sendBtn').textContent='...';
    const msgEl=addMessage('assistant','');
    const contentEl=msgEl.querySelector('.msg-content');
    contentEl.innerHTML='<span class="streaming-cursor"></span>';
    let fullText='';

    try{
      const resp=await fetch('/api/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt,conversationId})
      });
      const reader=resp.body.getReader();
      const decoder=new TextDecoder();
      let buffer='';

      while(true){
        const{done,value}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        const lines=buffer.split('\\n');
        buffer=lines.pop()||'';

        for(const line of lines){
          if(!line.startsWith('data: '))continue;
          const payload=line.slice(6).trim();
          if(payload==='[DONE]')continue;
          try{
            const json=JSON.parse(payload);
            if(json.error){fullText+=json.error;break}
            if(json.type==='token'&&json.content){fullText+=json.content}
            else if(json.choices&&json.choices[0]?.delta?.content){fullText+=json.choices[0].delta.content}
            else if(json.type==='metadata'&&json.conversationId){conversationId=json.conversationId}
            else if(typeof json.content==='string'){fullText+=json.content}
          }catch{
            if(payload&&payload!=='[DONE]')fullText+=payload;
          }
          contentEl.innerHTML=escapeHtml(fullText)+'<span class="streaming-cursor"></span>';
          msgEl.scrollIntoView({behavior:'smooth'});
        }
      }
    }catch(e){
      fullText=fullText||'Athena is not reachable. Make sure the fleet is running.';
    }

    contentEl.textContent=fullText;
    isStreaming=false;
    document.getElementById('sendBtn').textContent='Send';
  }
  </script>`

  res.send(layout('/chat', 'Chat', content, extraHead))
})

// ── HISTORY PAGE ───────────────────────────────────────────
app.get('/history', (req, res) => {
  const content = `
    <div class="content">
      <p class="muted mb-4">Your saved conversations from Mnemosyne.</p>
      <div class="card">
        <div class="card-hdr"><h3>Conversations</h3><button class="btn" onclick="loadHistory()">Refresh</button></div>
        <div class="card-body" id="historyList"><div class="muted">Loading...</div></div>
      </div>
    </div>`

  const extraHead = `<script>
  async function loadHistory(){
    document.getElementById('historyList').innerHTML='<div class="muted">Loading...</div>';
    try{
      const r=await fetch('/api/history');
      const d=await r.json();
      const convs=d.conversations||d||[];
      if(!convs.length&&!d.error){
        document.getElementById('historyList').innerHTML='<div class="muted">No saved conversations yet. Start chatting!</div>';
        return;
      }
      if(d.error){
        document.getElementById('historyList').innerHTML='<div class="muted">Mnemosyne is offline — start the fleet to see history.</div>';
        return;
      }
      let html='';
      (Array.isArray(convs)?convs:Object.values(convs)).forEach(c=>{
        const data=c.data||c;
        const meta=c.metadata||{};
        html+='<div style="padding:12px 0;border-bottom:1px solid #1a1a1d;display:flex;align-items:center;gap:12px">'
          +'<span>💬</span>'
          +'<div style="flex:1"><div style="font-weight:600;font-size:13px">'+(data.title||'Untitled')+'</div>'
          +'<div class="text-sm muted">'+(data.messageCount||0)+' messages &middot; '+(meta.createdAt||'').slice(0,10)+'</div></div>'
          +'<span class="badge badge-green">'+(data.messageCount||0)+' msgs</span>'
          +'</div>';
      });
      document.getElementById('historyList').innerHTML=html||'<div class="muted">No conversations found.</div>';
    }catch(e){
      document.getElementById('historyList').innerHTML='<div class="muted">Could not reach Mnemosyne.</div>';
    }
  }
  loadHistory();
  </script>`

  res.send(layout('/history', 'History', content, extraHead))
})

// ── MEMORY PAGE ────────────────────────────────────────────
app.get('/memory', (req, res) => {
  const content = `
    <div class="content">
      <div class="flex items-center gap-3 mb-4">
        <span style="font-size:24px">🧠</span>
        <div><div style="font-size:16px;font-weight:700">Memory Control Panel</div><div class="text-sm muted">All memories across all scopes.</div></div>
      </div>
      <div class="flex gap-3 mb-4">
        <select id="scopeFilter" onchange="loadMemory()"><option value="">All Scopes</option><option>tenant</option><option>shell</option><option>agent</option><option>agent-tenant</option><option>agent-shell</option></select>
        <select id="catFilter" onchange="loadMemory()"><option value="">All Categories</option><option>identity</option><option>preference</option><option>project</option><option>relationship</option><option>knowledge</option><option>system</option></select>
        <input type="text" id="memSearch" placeholder="Search memories..." oninput="filterMemory()" style="max-width:200px"/>
      </div>
      <div id="memCount" class="text-sm muted mb-4"></div>
      <div id="memoryList"><div class="muted">Loading...</div></div>
    </div>`

  const extraHead = `<script>
  let allMemories=[];
  async function loadMemory(){
    document.getElementById('memoryList').innerHTML='<div class="muted">Loading...</div>';
    try{
      const r=await fetch('/api/memory');
      const d=await r.json();
      allMemories=d.memories||[];
      if(d.error){document.getElementById('memoryList').innerHTML='<div class="muted">Mnemosyne is offline.</div>';return}
      renderMemories();
    }catch{document.getElementById('memoryList').innerHTML='<div class="muted">Could not reach Mnemosyne.</div>'}
  }
  function filterMemory(){renderMemories()}
  function renderMemories(){
    const scope=document.getElementById('scopeFilter').value;
    const cat=document.getElementById('catFilter').value;
    const q=document.getElementById('memSearch').value.toLowerCase();
    let filtered=allMemories.filter(m=>{
      if(scope&&m.scope!==scope)return false;
      if(cat&&m.category!==cat)return false;
      if(q&&!(m.key||'').toLowerCase().includes(q)&&!(m.value||'').toLowerCase().includes(q)&&!(m.tags||[]).join(' ').toLowerCase().includes(q))return false;
      return true;
    });
    document.getElementById('memCount').textContent=filtered.length+' memories'+(filtered.length!==allMemories.length?' (of '+allMemories.length+' total)':'');
    if(!filtered.length){document.getElementById('memoryList').innerHTML='<div class="muted">No memories found.</div>';return}
    const scopeColors={tenant:'#a78bfa',shell:'#60a5fa',agent:'#fb923c','agent-tenant':'#facc15','agent-shell':'#34d399'};
    const catColors={identity:'#f472b6',preference:'#818cf8',project:'#22d3ee',relationship:'#fb7185',knowledge:'#34d399',system:'#9ca3af'};
    let html='';
    filtered.forEach(m=>{
      const sc=scopeColors[m.scope]||'#71717a';
      const cc=catColors[m.category]||'#71717a';
      html+='<div class="card mb-4" style="padding:16px">'
        +'<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">'
        +'<span class="badge" style="background:'+sc+'20;color:'+sc+';border:1px solid '+sc+'30">'+m.scope+'</span>'
        +'<span class="badge" style="background:'+cc+'20;color:'+cc+';border:1px solid '+cc+'30">'+m.category+'</span>'
        +'<span class="badge badge-gray">'+(m.confidence*100).toFixed(0)+'%</span>'
        +(m.active?'':'<span class="badge badge-red">forgotten</span>')
        +'</div>'
        +'<div style="font-weight:600;font-size:13px;margin-bottom:4px">'+escHtml(m.key)+'</div>'
        +'<div style="color:#a1a1aa;font-size:12px;margin-bottom:8px">'+escHtml(m.value)+'</div>'
        +'<div class="text-sm muted">agent:'+m.agentId+' &middot; '+(m.createdAt||'').slice(0,10)+'</div>'
        +(m.tags&&m.tags.length?'<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">'+m.tags.map(t=>'<span style="background:#1a1a1d;padding:2px 6px;border-radius:4px;font-size:10px;color:#a1a1aa">'+escHtml(t)+'</span>').join('')+'</div>':'')
        +'</div>';
    });
    document.getElementById('memoryList').innerHTML=html;
  }
  function escHtml(t){return(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  loadMemory();
  </script>`

  res.send(layout('/memory', 'Memory', content, extraHead))
})

// ── SERVICES PAGE ──────────────────────────────────────────
app.get('/services', (req, res) => {
  const catalog = [
    { name: 'Salesforce', icon: '☁️', desc: 'Connect your Salesforce org for CRM data access via MCP', status: 'available' },
    { name: 'GitHub', icon: '🐙', desc: 'Access repositories, issues, and pull requests', status: 'available' },
    { name: 'Google', icon: '🔍', desc: 'Calendar, Drive, Gmail, and Sheets integration', status: 'available' },
    { name: 'HubSpot', icon: '🟠', desc: 'Connect HubSpot CRM for contacts, deals, and marketing', status: 'available' },
    { name: 'Workday', icon: '📋', desc: 'HR, payroll, and workforce management', status: 'coming_soon' },
    { name: 'Slack', icon: '💬', desc: 'Team messaging and workflow automation', status: 'coming_soon' },
  ]

  const cards = catalog.map(s => `
    <div class="card p-4">
      <div style="font-size:28px;margin-bottom:12px">${s.icon}</div>
      <div style="font-weight:600;margin-bottom:4px">${s.name}</div>
      <div class="text-sm muted mb-4">${s.desc}</div>
      <button class="btn ${s.status === 'available' ? 'btn-primary' : ''}" ${s.status === 'coming_soon' ? 'disabled style="opacity:.5"' : ''}>${s.status === 'available' ? '+ Connect' : 'Coming Soon'}</button>
    </div>`).join('')

  const content = `
    <div class="content">
      <p class="muted mb-4">Connect enterprise services to enable MCP-powered AI workflows.</p>
      <div class="section-hdr">Connected</div>
      <div class="card mb-4"><div class="card-body"><div class="muted" style="text-align:center;padding:20px">No services connected yet. Add one below to get started.</div></div></div>
      <div class="section-hdr">Available Services</div>
      <div class="grid-3">${cards}</div>
    </div>`

  res.send(layout('/services', 'Services', content))
})

// ── SERVICE DESK PAGE ──────────────────────────────────────
app.get('/service-desk', (req, res) => {
  const content = `
    <div class="content">
      <p class="muted mb-4">Support cases and ticket management.</p>
      <div class="card">
        <div class="card-hdr"><h3>Cases</h3></div>
        <div class="card-body">
          <div class="muted" style="text-align:center;padding:20px;border:1px dashed #1a1a1d;border-radius:8px">
            Connect a service in <a href="/services">Services</a> to enable the Service Desk.
          </div>
        </div>
      </div>
    </div>`

  res.send(layout('/service-desk', 'Service Desk', content))
})

// ── AGENTS PAGE ────────────────────────────────────────────
app.get('/agents', (req, res) => {
  const agents = [
    { name: 'Athena', icon: '🦉', desc: 'General-purpose LLM router with multi-provider support', caps: ['chat','mcp','reasoning'], active: true },
    { name: 'Apollo', icon: '☀️', desc: 'Voice-first conversational AI with TTS and STT', caps: ['chat','voice','mcp'], active: false },
    { name: 'Hermes', icon: '✉️', desc: 'Communications specialist — Slack, email, notifications', caps: ['chat','mcp'], active: false },
    { name: 'Hephaestus', icon: '🔨', desc: 'Code generation, PR review, engineering workflows', caps: ['chat','code','mcp'], active: false },
  ]

  const cards = agents.map(a => `
    <div class="card p-4 mb-4" style="display:flex;align-items:center;gap:16px;${a.active ? 'border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.03)' : 'cursor:pointer'}">
      <div style="font-size:32px">${a.icon}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${a.name} ${a.active ? '<span class="badge badge-green">Active</span>' : ''}</div>
        <div class="text-sm muted mb-4">${a.desc}</div>
        <div style="display:flex;gap:4px">${a.caps.map(c => '<span class="badge badge-gray">' + c + '</span>').join('')}</div>
      </div>
    </div>`).join('')

  const content = `<div class="content">${cards}</div>`
  res.send(layout('/agents', 'Agents', content))
})

// ── DOCS PAGE ──────────────────────────────────────────────
app.get('/docs', (req, res) => {
  const sections = [
    { icon: '🚀', title: 'Getting Started', desc: 'Set up your sovereign node and connect your first service' },
    { icon: '📡', title: 'Service Registry', desc: 'How MCP services are discovered and connected' },
    { icon: '🔧', title: 'MCP Protocol', desc: 'Model Context Protocol tool integration reference' },
    { icon: '🤖', title: 'Agent System', desc: 'How agents work and how to configure them' },
    { icon: '🔐', title: 'OAuth & Security', desc: 'Authentication flows and data sovereignty' },
    { icon: '📖', title: 'API Reference', desc: 'Complete API documentation for all fleet services' },
  ]

  const cards = sections.map(s => `
    <div class="card p-4">
      <div style="font-size:24px;margin-bottom:8px">${s.icon}</div>
      <div style="font-weight:600;margin-bottom:4px">${s.title}</div>
      <div class="text-sm muted">${s.desc}</div>
    </div>`).join('')

  const content = `
    <div class="content">
      <p class="muted mb-4">Full documentation is being built. Check back soon.</p>
      <div class="grid-2">${cards}</div>
    </div>`

  res.send(layout('/docs', 'Docs', content))
})

// ── SETTINGS PAGE ──────────────────────────────────────────
app.get('/settings', (req, res) => {
  const node = getNodeInfo()

  const content = `
    <div class="content" style="max-width:600px">
      <div class="section-hdr">Node</div>
      <div class="card mb-4">
        <div class="card-body">
          <table style="width:100%;font-size:13px">
            <tr><td class="muted" style="padding:6px 0;width:140px">Node Name</td><td>${node.node_name}</td></tr>
            <tr><td class="muted" style="padding:6px 0">Node ID</td><td class="mono">${node.node_id}</td></tr>
            <tr><td class="muted" style="padding:6px 0">Architecture</td><td>${node.architecture}</td></tr>
            <tr><td class="muted" style="padding:6px 0">Version</td><td>${node.version}</td></tr>
            <tr><td class="muted" style="padding:6px 0">Platform</td><td>${node.platform || 'macOS'}</td></tr>
            <tr><td class="muted" style="padding:6px 0">Connection</td><td>${node.connection_mode || 'local'}</td></tr>
            <tr><td class="muted" style="padding:6px 0">Installed</td><td>${(node.installed_at || '').slice(0, 10)}</td></tr>
          </table>
        </div>
      </div>

      <div class="section-hdr">Fleet</div>
      <div class="card mb-4">
        <div class="card-body">
          <table style="width:100%;font-size:13px">
            <tr><td class="muted" style="padding:6px 0;width:140px">Dashboard</td><td><a href="/status">localhost:${PORT}/status</a></td></tr>
            <tr><td class="muted" style="padding:6px 0">API Gateway</td><td class="mono">localhost:3451</td></tr>
            <tr><td class="muted" style="padding:6px 0">Athena LLM</td><td class="mono">localhost:3401</td></tr>
            <tr><td class="muted" style="padding:6px 0">Data Dir</td><td class="mono">~/.turtleshell/</td></tr>
            <tr><td class="muted" style="padding:6px 0">Fleet Dir</td><td class="mono">~/turtleshell/</td></tr>
            <tr><td class="muted" style="padding:6px 0">Install Log</td><td class="mono">/var/log/turtleshell-install.log</td></tr>
          </table>
        </div>
      </div>

      <div class="section-hdr">About</div>
      <div class="card">
        <div class="card-body text-sm muted">
          TurtleShell.ai Off-Grid v${node.version || '1.7.0'}<br/>
          Cosmos-Logos v${node.cosmos_logos_version || '1.0.3'}<br/>
          CloudPremise LLC &middot; 2026<br/>
          License: Proprietary
        </div>
      </div>
    </div>`

  res.send(layout('/settings', 'Settings', content))
})

// ── CONNECT ROUTES ────────────────────────────────────────

// GET /connect — Self-onboarding page (standalone, no layout wrapper)
app.get('/connect', async (req, res) => {
  const node = getNodeInfo()
  const ips = getLocalIPs()
  const httpsEnabled = fs.existsSync(path.join(CERT_DIR, 'node-cert.pem'))
  // Use the real host IP, not req.hostname (which may be localhost inside Docker)
  const host = ips[0] || req.hostname || 'localhost'
  const scheme = httpsEnabled ? 'https' : 'http'
  // Route through the offgrid proxy (TLS termination) — not direct to Ares
  const athenaUrl = `${scheme}://${host}:${PORT}/v1/athena`
  const dashUrl = `${scheme}://${host}:717`

  // QR contains the Athena URL — format the iOS app expects
  const qrUrl = athenaUrl

  let qrDataUrl = ''
  try {
    qrDataUrl = await QRCode.toDataURL(qrUrl, {
      color: { dark: '#3ddc84', light: '#00000000' },
      margin: 1,
      width: 240,
    })
  } catch {}

  const certSection = httpsEnabled ? `
    <div class="section">
      <h2>Install Certificate</h2>
      <p class="desc">Your node uses a self-signed certificate. Install the root CA on your iPhone to enable secure connections.</p>
      <a href="/connect/cert" class="btn-dl">Download rootCA.pem</a>
      <div class="steps">
        <div class="step"><span class="step-num">1</span>Tap <strong>Download rootCA.pem</strong> above</div>
        <div class="step"><span class="step-num">2</span>Open <strong>Settings &rarr; General &rarr; VPN &amp; Device Management</strong></div>
        <div class="step"><span class="step-num">3</span>Tap the downloaded profile and install it</div>
        <div class="step"><span class="step-num">4</span>Go to <strong>Settings &rarr; General &rarr; About &rarr; Certificate Trust Settings</strong></div>
        <div class="step"><span class="step-num">5</span>Enable full trust for the TurtleShell root certificate</div>
      </div>
    </div>` : ''

  const ipRows = ips.map(ip => `<div class="ip-row"><code>${scheme}://${ip}:${PORT}</code></div>`).join('')

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect to ${node.node_name || 'TurtleShell Node'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
:root {
  --deep: #060910;
  --navy: #0d1117;
  --green: #3ddc84;
  --shell: #f4f0e8;
  --muted: #6b7280;
  --gold: #f5a623;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--deep);color:var(--shell);font-family:'DM Sans',-apple-system,sans-serif;min-height:100vh}
code,.mono{font-family:'JetBrains Mono',monospace}
.page{max-width:540px;margin:0 auto;padding:40px 24px 60px}
.header{text-align:center;margin-bottom:40px}
.turtle{font-size:56px;margin-bottom:12px}
.node-name{font-size:22px;font-weight:700;color:var(--shell);margin-bottom:4px}
.node-id{font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace}
.status-badge{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:rgba(61,220,132,.1);color:var(--green);border:1px solid rgba(61,220,132,.25)}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}
.section{background:var(--navy);border:1px solid #1a1f2e;border-radius:12px;padding:24px;margin-bottom:20px}
.section h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green);margin-bottom:12px}
.desc{font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:16px}
.athena-url{background:rgba(61,220,132,.08);border:1px solid rgba(61,220,132,.2);border-radius:8px;padding:12px 16px;font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--green);word-break:break-all;cursor:pointer;transition:background .15s}
.athena-url:hover{background:rgba(61,220,132,.15)}
.btn-dl{display:inline-block;padding:10px 20px;border-radius:8px;background:var(--green);color:#060910;font-size:13px;font-weight:700;text-decoration:none;transition:background .15s}
.btn-dl:hover{background:#34c478}
.steps{margin-top:16px}
.step{display:flex;align-items:flex-start;gap:12px;padding:8px 0;font-size:13px;color:var(--shell);line-height:1.5}
.step-num{width:22px;height:22px;border-radius:50%;background:rgba(61,220,132,.15);color:var(--green);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.qr-wrap{text-align:center;padding:16px 0}
.qr-wrap img{border-radius:12px;background:var(--navy);padding:12px}
.qr-label{font-size:11px;color:var(--muted);margin-top:10px;letter-spacing:.5px}
.ip-row{padding:8px 0;border-bottom:1px solid #1a1f2e}
.ip-row:last-child{border-bottom:none}
.ip-row code{font-size:13px;color:var(--green)}
.footer{text-align:center;margin-top:32px;font-size:11px;color:var(--muted);line-height:1.8}
.footer strong{color:var(--shell);font-weight:600}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="turtle">&#x1F422;</div>
    <div class="node-name">${node.node_name || 'TurtleShell Node'}</div>
    <div class="node-id">${node.node_id || 'unknown'}</div>
    <div class="status-badge"><span class="status-dot"></span>Online</div>
  </div>

  <div class="section">
    <h2>Athena Endpoint</h2>
    <p class="desc">Your sovereign AI endpoint. Tap to copy.</p>
    <div class="athena-url" onclick="navigator.clipboard.writeText(this.textContent)">${athenaUrl}</div>
  </div>

  ${certSection}

  <div class="section">
    <h2>Connect iPhone</h2>
    <p class="desc">Scan with the TurtleShell.ai iOS app to auto-configure your device.</p>
    <div class="qr-wrap">
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR Code" width="200" height="200"/>` : '<div class="desc">QR generation unavailable</div>'}
      <div class="qr-label">turtleshell:// deep link</div>
    </div>
  </div>

  <div class="section">
    <h2>Manual Setup</h2>
    <p class="desc">Use any of these addresses from your local network:</p>
    <div class="ip-row"><code>${scheme}://localhost:${PORT}</code></div>
    ${ipRows}
  </div>

  <div class="footer">
    <strong>TurtleShell.ai</strong> Off-Grid<br/>
    ${node.version || '1.7.0'} &middot; CloudPremise LLC
  </div>
</div>
</body>
</html>`)
})

// GET /connect/cert — Download the root CA certificate
app.get('/connect/cert', (req, res) => {
  const caPath = path.join(CERT_DIR, 'rootCA.pem')
  if (!fs.existsSync(caPath)) {
    return res.status(404).json({ error: 'No root CA found. Run cert generation first.' })
  }
  res.setHeader('Content-Type', 'application/x-pem-file')
  res.setHeader('Content-Disposition', 'attachment; filename="TurtleShell-rootCA.pem"')
  res.send(fs.readFileSync(caPath))
})

// GET /connect/qr — Returns QR code as PNG image
app.get('/connect/qr', async (req, res) => {
  const node = getNodeInfo()
  const ips = getLocalIPs()
  const host = req.query.host || ips[0] || 'localhost'
  const httpsEnabled = fs.existsSync(path.join(CERT_DIR, 'node-cert.pem'))
  const scheme = httpsEnabled ? 'https' : 'http'
  const athenaUrl = `${scheme}://${host}:${PORT}/v1/athena`
  try {
    const png = await QRCode.toBuffer(athenaUrl, {
      color: { dark: '#3ddc84', light: '#00000000' },
      margin: 1,
      width: 300,
    })
    res.setHeader('Content-Type', 'image/png')
    res.send(png)
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' })
  }
})

// GET /connect/manifest — JSON with node info + endpoints
app.get('/connect/manifest', (req, res) => {
  const node = getNodeInfo()
  const ips = getLocalIPs()
  const httpsEnabled = fs.existsSync(path.join(CERT_DIR, 'node-cert.pem'))
  const scheme = httpsEnabled ? 'https' : 'http'
  const host = req.hostname || ips[0] || 'localhost'

  res.json({
    node_id: node.node_id,
    node_name: node.node_name,
    version: node.version,
    architecture: node.architecture,
    platform: node.platform || 'macos',
    https_enabled: httpsEnabled,
    endpoints: {
      athena: `${scheme}://${host}:${PORT}/v1/athena`,
      dashboard: `${scheme}://${host}:${PORT}/nodestatus`,
      connect: `http://${host}:${PORT}/connect`,
      health: `${scheme}://${host}:${PORT}/health`,
    },
    local_ips: ips,
    port: PORT,
  })
})

// ── START ──────────────────────────────────────────────────
const CERT = path.join(CERT_DIR, 'node-cert.pem')
const KEY = path.join(CERT_DIR, 'node-key.pem')
const HTTPS_ENABLED = process.env.HTTPS_ENABLED === 'true'

function printStartup(scheme) {
  const ips = getLocalIPs()
  console.log(`\n\u{1F422} TurtleShell Off-Grid Node`)
  console.log(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`)
  console.log(`Mode:      ${scheme.toUpperCase()}`)
  console.log(`Dashboard: ${scheme}://localhost:${PORT}/nodestatus`)
  console.log(`Connect:   http://localhost:${PORT}/connect`)
  ips.forEach(ip => console.log(`           http://${ip}:${PORT}/connect`))
  console.log(`\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`)
}

if (HTTPS_ENABLED && fs.existsSync(CERT) && fs.existsSync(KEY)) {
  const credentials = { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }
  https.createServer(credentials, app).listen(PORT, () => printStartup('https'))
  // HTTP on PORT+1 for cert downloads (must work before trust established)
  http.createServer((req, res) => {
    if (req.url.startsWith('/connect')) return app(req, res)
    const host = (req.headers.host || '').split(':')[0]
    res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` })
    res.end()
  }).listen(PORT + 1)
} else {
  http.createServer(app).listen(PORT, () => printStartup('http'))
}
