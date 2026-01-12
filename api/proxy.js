export default async function handler(req, res) {
  // ---------- CORS ----------
  const origin = req.headers.origin;

  const isAllowed =
    origin === "https://storybound-app.vercel.app" ||
    (origin && /^https:\/\/storybound(-app)?-[a-z0-9]+-romans-projects-[a-z0-9]+\.vercel\.app$/.test(origin));

  res.setHeader(
    "Access-Control-Allow-Origin",
    isAllowed ? origin : "https://storybound-app.vercel.app"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, model, temperature, max_tokens } = req.body || {};

    if (!Array.isArray(messages)) {
      throw new Error("Invalid messages payload");
    }

    const XAI_API_KEY =
      process.env.XAI_API_KEY || process.env.GROK_API_KEY;

    if (!XAI_API_KEY) {
      throw new Error("XAI_API_KEY not set");
    }

    // ---------- CALL GROK ----------
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "grok-4-1-fast-reasoning",
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 1000
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Grok HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();

    // =====================================================
    // 🔒 ONE-LINE CONTRACT ASSERTION (CRITICAL)
    // =====================================================
    if (!data?.choices?.[0]?.message?.content) {
      throw new Error("INVALID_MODEL_RESPONSE_SHAPE");
    }

    // ---------- NORMALIZE TO OPENAI ----------
    return res.status(200).json({
      id: data.id || "storybound-grok",
      object: "chat.completion",
      created: data.created || Math.floor(Date.now() / 1000),
      model: data.model || "grok",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: data.choices[0].message.content
          },
          finish_reason: data.choices[0].finish_reason || "stop"
        }
      ]
    });

  } catch (err) {
    console.error("Storybound proxy error:", err);

    return res.status(500).json({
      error: "FATE_STUMBLED",
      detail: err.message
    });
  }
}
