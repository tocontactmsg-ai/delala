// functions/api.js
// Cloudflare Pages Function: simple GitHub proxy for admin UI
export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const env = context.env || {};
  const GITHUB_REPO = env.GITHUB_REPO;
  const GITHUB_PAT = env.GITHUB_PAT;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  try {
    // GET raw: /api/raw?path=static/ads.json
    if (url.pathname.endsWith("/raw") && request.method === "GET") {
      const path = url.searchParams.get("path");
      if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400, headers: corsHeaders });
      if (!GITHUB_REPO) return new Response(JSON.stringify({ error: "GITHUB_REPO not set" }), { status: 500, headers: corsHeaders });

      const api = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
      const headers = { "Accept": "application/vnd.github.v3.raw" };
      if (GITHUB_PAT) headers["Authorization"] = `token ${GITHUB_PAT}`;

      const t0 = Date.now();
      const resp = await fetch(api, { headers });
      const elapsed = Date.now() - t0;
      const text = await resp.text();
      return new Response(JSON.stringify({ status: resp.status, elapsed_ms: elapsed, content: text }), { status: resp.ok ? 200 : resp.status, headers: corsHeaders });
    }

    // PUT: /api/put  body: { path, contentBase64, message?, branch? }
    if (url.pathname.endsWith("/put") && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || !body.path || !body.contentBase64) return new Response(JSON.stringify({ error: "path & contentBase64 required" }), { status: 400, headers: corsHeaders });
      if (!GITHUB_REPO) return new Response(JSON.stringify({ error: "GITHUB_REPO not set" }), { status: 500, headers: corsHeaders });
      if (!GITHUB_PAT) return new Response(JSON.stringify({ error: "GITHUB_PAT not set" }), { status: 500, headers: corsHeaders });

      const branch = body.branch || "main";
      const api = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(body.path)}`;

      // try read sha
      const metaResp = await fetch(api + `?ref=${encodeURIComponent(branch)}`, { headers: { "Accept": "application/vnd.github.v3+json", "Authorization": `token ${GITHUB_PAT}` } });
      let sha;
      if (metaResp.status === 200) try { sha = (await metaResp.json()).sha; } catch (e) { }

      const putBody = { message: body.message || `update ${body.path} via Pages Function`, content: body.contentBase64, branch };
      if (sha) putBody.sha = sha;

      const t0 = Date.now();
      const resp = await fetch(api, {
        method: "PUT",
        headers: { "Accept": "application/vnd.github.v3+json", "Authorization": `token ${GITHUB_PAT}`, "Content-Type": "application/json" },
        body: JSON.stringify(putBody)
      });
      const elapsed = Date.now() - t0;
      const text = await resp.text().catch(() => null);
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
      return new Response(JSON.stringify({ status: resp.status, elapsed_ms: elapsed, result: parsed }), { status: resp.ok ? 200 : resp.status, headers: corsHeaders });
    }

    // DELETE: /api/delete body: { path, message?, branch? }
    if (url.pathname.endsWith("/delete") && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || !body.path) return new Response(JSON.stringify({ error: "path required" }), { status: 400, headers: corsHeaders });
      if (!GITHUB_REPO) return new Response(JSON.stringify({ error: "GITHUB_REPO not set" }), { status: 500, headers: corsHeaders });
      if (!GITHUB_PAT) return new Response(JSON.stringify({ error: "GITHUB_PAT not set" }), { status: 500, headers: corsHeaders });

      const branch = body.branch || "main";
      const api = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(body.path)}`;

      const metaResp = await fetch(api + `?ref=${encodeURIComponent(branch)}`, { headers: { "Accept": "application/vnd.github.v3+json", "Authorization": `token ${GITHUB_PAT}` } });
      if (!metaResp.ok) {
        const t = await metaResp.text().catch(() => null);
        return new Response(JSON.stringify({ error: "meta fetch failed", status: metaResp.status, text: t }), { status: metaResp.status, headers: corsHeaders });
      }
      const file = await metaResp.json();
      if (!file.sha) return new Response(JSON.stringify({ error: "no sha on file" }), { status: 500, headers: corsHeaders });

      const t0 = Date.now();
      const resp = await fetch(api, {
        method: "DELETE",
        headers: { "Accept": "application/vnd.github.v3+json", "Authorization": `token ${GITHUB_PAT}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: body.message || "delete via Pages Function", sha: file.sha, branch })
      });
      const elapsed = Date.now() - t0;
      const text = await resp.text().catch(() => null);
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
      return new Response(JSON.stringify({ status: resp.status, elapsed_ms: elapsed, result: parsed }), { status: resp.ok ? 200 : resp.status, headers: corsHeaders });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.toString() }), { status: 500, headers: corsHeaders });
  }
}
