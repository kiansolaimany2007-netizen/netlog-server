'use strict';
/*
 * NetLog Server
 * ─────────────────────────────────────────────────────────────
 * Receives log entries from the ESP32 via POST /log
 * Serves a searchable dashboard at GET /
 * Exposes GET /api/logs for the dashboard to query
 *
 * Free deployment: Render.com (render.yaml included)
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(express.json());
app.use(cors());                  // lets the published artifact dashboard read this

// ── in-memory store (Render free tier has no disk persistence) ──
const MAX  = 100_000;
let   logs = [];                  // newest first

// ── receive a log entry from the ESP32 ───────────────────────
app.post('/log', (req, res) => {
  const { domain, type, device } = req.body || {};
  if (!domain) return res.sendStatus(400);
  logs.unshift({
    ts:     new Date().toISOString(),
    domain: String(domain).slice(0, 200),
    type:   String(type   || 'DNS').slice(0, 10),
    device: String(device || 'esp32').slice(0, 40),
  });
  if (logs.length > MAX) logs.length = MAX;
  res.sendStatus(200);
});

// ── JSON feed for the dashboard ──────────────────────────────
app.get('/api/logs', (req, res) => {
  const q    = (req.query.q || '').toLowerCase();
  const page = Math.max(0, parseInt(req.query.page || '0', 10));
  const size = 200;

  const filtered = q
    ? logs.filter(l => (l.domain + ' ' + l.device).toLowerCase().includes(q))
    : logs;

  res.json({
    total: filtered.length,
    page,
    items: filtered.slice(page * size, (page + 1) * size),
  });
});

// ── health check ─────────────────────────────────────────────
app.get('/ping', (_req, res) => res.json({ ok: true, count: logs.length }));

// ── dashboard ────────────────────────────────────────────────
app.get('/', (_req, res) => res.send(DASHBOARD));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NetLog server running on port ${PORT}`));

// ── dashboard HTML (served from the root URL) ─────────────────
const DASHBOARD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>NetLog Dashboard</title>
<style>
:root{--bg:#0f0f0f;--fg:#eee;--mut:#777;--ok:#4cc16f;--warn:#e6a817;
      --line:#ffffff18;--card:#161616;--acc:#6ea8ff;
      padding-top:env(safe-area-inset-top,0px);
      padding-bottom:env(safe-area-inset-bottom,0px)}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;
     margin:0;padding:14px 12px 60px;max-width:900px}
h1{font-size:1.3rem;margin:0 0 4px}
.mut{color:var(--mut);font-size:.85rem}
#q{width:100%;padding:.7rem;font-size:1rem;border-radius:10px;
   border:1px solid var(--line);background:var(--card);color:var(--fg);margin:10px 0 6px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{background:var(--card);border-radius:999px;padding:.22rem .65rem;font-size:.8rem;border:1px solid var(--line)}
table{width:100%;border-collapse:collapse}
td{padding:.4rem .3rem;border-bottom:1px solid var(--line);font-size:.85rem;word-break:break-all;vertical-align:top}
td:first-child{white-space:nowrap;color:var(--mut);font-size:.75rem;min-width:80px}
small{color:var(--mut)}
.pgrow{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
button{padding:.5rem .9rem;border-radius:8px;border:1px solid var(--line);
       background:var(--card);color:var(--fg);cursor:pointer;font-size:.9rem}
#status{font-size:.8rem;color:var(--mut);margin:0 0 8px}
</style>
</head>
<body>
<h1>NetLog <span style="color:var(--ok)" id="dot">&#9679; live</span></h1>
<p id="status">Loading…</p>
<input id="q" placeholder="Search domain, device…" autocomplete="off">
<div id="chips" class="chips"></div>
<table id="t"></table>
<div class="pgrow">
  <button id="prev" disabled>← Prev</button>
  <button id="next">Next →</button>
  <span id="pginfo" style="padding:.5rem 0;font-size:.85rem;color:var(--mut)"></span>
</div>
<script>
let page=0, total=0;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

async function load(){
  const q=document.getElementById('q').value;
  try{
    const res=await fetch('/api/logs?q='+encodeURIComponent(q)+'&page='+page);
    const d=await res.json();
    total=d.total;

    // top domains chip bar
    const counts={};
    d.items.forEach(r=>counts[r.domain]=(counts[r.domain]||0)+1);
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
    document.getElementById('chips').innerHTML=top.map(([dom,n])=>
      '<span class="chip">'+esc(dom)+' <b>'+n+'</b></span>').join('');

    document.getElementById('status').textContent=
      total+' entries total \u00b7 showing '+(page*200+1)+'\u2013'+Math.min((page+1)*200,total);
    document.getElementById('pginfo').textContent='Page '+(page+1)+' of '+Math.ceil(total/200||1);
    document.getElementById('prev').disabled=page===0;
    document.getElementById('next').disabled=(page+1)*200>=total;

    document.getElementById('t').innerHTML=d.items.map(r=>
      '<tr><td>'+new Date(r.ts).toLocaleTimeString()+'<br><small>'+esc(r.device)+'</small></td>'+
      '<td>'+esc(r.domain)+'<br><small>'+esc(r.type)+'</small></td></tr>').join('');
  }catch(e){
    document.getElementById('dot').style.color='#a33';
    document.getElementById('dot').textContent='\u25cb offline';
  }
}

document.getElementById('q').addEventListener('input',()=>{page=0;load();});
document.getElementById('prev').onclick=()=>{if(page>0){page--;load();}};
document.getElementById('next').onclick=()=>{page++;load();};

load();
setInterval(load,4000);
</script>
</body>
</html>`;
