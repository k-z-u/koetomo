// こえとも：Gemini Live の「使い捨ての鍵（エフェメラルトークン）」を配るだけの Worker。
// 本物の API キーはこの Worker の秘密設定（GEMINI_API_KEY）にだけ置き、ブラウザには渡さない。
// DB（KV / D1 など）は使わない。悪用よけの回数制限はメモリ上だけで持つ（ゆるい一応の制限）。

const PER_MINUTE = 5;            // 同じ回線から 1 分間に始められる会話の数
const hits = new Map();          // ip -> [時刻, ...]（この Worker インスタンスの中だけ）

function limited(ip) {
  const now = Date.now(), recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();   // メモリを使いすぎないように
  return false;
}

function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get("Origin") || "";
    const h = cors(origin, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (url.pathname === "/health") return json({ ok: true, configured: !!env.GEMINI_API_KEY }, 200, h);
    if (url.pathname !== "/token" || req.method !== "POST") return json({ error: "not_found" }, 404, h);

    if (!env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin)) return json({ error: "forbidden" }, 403, h);
    if (!env.GEMINI_API_KEY) return json({ error: "not_configured" }, 503, h);
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    if (limited(ip)) return json({ error: "slow_down", retryAfter: 60 }, 429, h);

    const now = Date.now();
    const body = {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),          // 会話できるのは最長 30 分
      newSessionExpireTime: new Date(now + 60_000).toISOString(),     // 1 分以内に接続しないと無効
      liveConnectConstraints: {
        model: `models/${env.MODEL}`,
        config: { responseModalities: ["AUDIO"] },
      },
    };
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 429) return json({ error: "busy" }, 429, h);          // 共有の無料枠がいっぱい
    if (!r.ok) {
      console.log("auth_tokens error", r.status, (await r.text()).slice(0, 300));
      return json({ error: "upstream", status: r.status }, 502, h);
    }
    const t = await r.json();
    return json({ token: t.name, expireTime: body.expireTime, model: env.MODEL }, 200, { ...h, "Cache-Control": "no-store" });
  },
};
