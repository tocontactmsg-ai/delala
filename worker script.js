/* Minimal GitHub proxy Worker: /api/raw, /api/put, /api/delete
   - Keep GITHUB_REPO and GITHUB_PAT as environment variables/secrets.
   - You can leave ALLOWED_ORIGINS empty for testing; add your domain(s) for production.
*/
addEventListener('fetch', event => event.respondWith(handleRequest(event.request)));

const ALLOWED_ORIGINS = []; // e.g. ['https://yourproject.pages.dev', 'https://www.yourdomain.com']
const REPO = typeof GITHUB_REPO !== 'undefined' ? GITHUB_REPO : '';
const PAT  = typeof GITHUB_PAT !== 'undefined' ? GITHUB_PAT : '';

function jsonResponse(obj, status=200, origin='*'){
  return new Response(JSON.stringify(obj), { status, headers:{
    'Content-Type':'application/json;charset=utf-8',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }});
}

function isAllowedOrigin(origin){
  if(!origin) return true;
  if(ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

async function handleRequest(request){
  if(request.method === 'OPTIONS') return jsonResponse({ ok:true }, 200, request.headers.get('origin') || '*');
  const origin = request.headers.get('origin') || '';
  if(!isAllowedOrigin(origin)) return jsonResponse({ error:'origin not allowed' }, 403, origin || '*');
  if(!REPO) return jsonResponse({ error:'GITHUB_REPO not configured' }, 500, origin || '*');

  const url = new URL(request.url);
  try{
    if(url.pathname === '/api/raw' && request.method === 'GET'){
      const path = url.searchParams.get('path'); if(!path) return jsonResponse({ error:'missing path' }, 400, origin||'*');
      const apiUrl = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}`;
      const headers = { 'Accept':'application/vnd.github.v3.raw' }; if(PAT) headers['Authorization'] = `token ${PAT}`;
      const t0 = Date.now();
      const resp = await fetch(apiUrl, { headers });
      const elapsed = Date.now() - t0;
      const rate = { remaining: resp.headers.get('x-ratelimit-remaining'), reset: resp.headers.get('x-ratelimit-reset') };
      const text = await resp.text();
      return jsonResponse({ status: resp.status, elapsed_ms: elapsed, rate, content: text }, resp.ok ? 200 : resp.status, origin||'*');
    }

    if(url.pathname === '/api/put' && request.method === 'POST'){
      const body = await request.json().catch(()=>null);
      if(!body || !body.path || !body.contentBase64) return jsonResponse({ error:'path & contentBase64 required' }, 400, origin||'*');
      if(!PAT) return jsonResponse({ error:'GITHUB_PAT not configured' }, 500, origin||'*');
      const branch = body.branch || 'main', message = body.message || `update ${body.path} via worker`;
      const apiUrl = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(body.path)}`;
      const metaResp = await fetch(apiUrl + `?ref=${encodeURIComponent(branch)}`, { headers:{ 'Accept':'application/vnd.github.v3+json', 'Authorization': `token ${PAT}` }});
      let sha; if(metaResp.status === 200) try{ sha = (await metaResp.json()).sha }catch(e){}
      const putBody = { message, content: body.contentBase64, branch }; if(sha) putBody.sha = sha;
      const t0 = Date.now();
      const resp = await fetch(apiUrl, { method:'PUT', headers:{ 'Accept':'application/vnd.github.v3+json','Authorization': `token ${PAT}`, 'Content-Type':'application/json' }, body: JSON.stringify(putBody) });
      const elapsed = Date.now() - t0; const text = await resp.text().catch(()=>null);
      let parsed; try{ parsed = JSON.parse(text) }catch(e){ parsed = { raw:text } }
      const rate = { remaining: resp.headers.get('x-ratelimit-remaining'), reset: resp.headers.get('x-ratelimit-reset') };
      return jsonResponse({ status: resp.status, elapsed_ms: elapsed, rate, result: parsed }, resp.ok ? 200 : resp.status, origin||'*');
    }

    if(url.pathname === '/api/delete' && request.method === 'POST'){
      const body = await request.json().catch(()=>null);
      if(!body || !body.path) return jsonResponse({ error:'path required' }, 400, origin||'*');
      if(!PAT) return jsonResponse({ error:'GITHUB_PAT not configured' }, 500, origin||'*');
      const branch = body.branch || 'main';
      const apiUrl = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(body.path)}`;
      const metaResp = await fetch(apiUrl + `?ref=${encodeURIComponent(branch)}`, { headers:{ 'Accept':'application/vnd.github.v3+json','Authorization': `token ${PAT}` }});
      if(!metaResp.ok) { const txt = await metaResp.text().catch(()=>null); return jsonResponse({ error:'meta fetch failed', status: metaResp.status, text: txt }, metaResp.status, origin||'*'); }
      const meta = await metaResp.json(); if(!meta.sha) return jsonResponse({ error:'no sha on file' }, 500, origin||'*');
      const t0 = Date.now();
      const resp = await fetch(apiUrl, { method:'DELETE', headers:{ 'Accept':'application/vnd.github.v3+json','Authorization': `token ${PAT}`, 'Content-Type':'application/json' }, body: JSON.stringify({ message: body.message || 'delete via worker', sha: meta.sha, branch })});
      const elapsed = Date.now() - t0; const text = await resp.text().catch(()=>null);
      let parsed; try{ parsed = JSON.parse(text) }catch(e){ parsed = { raw:text } }
      const rate = { remaining: resp.headers.get('x-ratelimit-remaining'), reset: resp.headers.get('x-ratelimit-reset') };
      return jsonResponse({ status: resp.status, elapsed_ms: elapsed, rate, result: parsed }, resp.ok ? 200 : resp.status, origin||'*');
    }

    return jsonResponse({ error:'use /api/raw, /api/put, or /api/delete' }, 404, origin||'*');
  } catch(e){ return jsonResponse({ error: e.message || String(e) }, 500, origin||'*'); }
}
