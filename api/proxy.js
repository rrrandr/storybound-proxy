export default async function handler(req, res) {
  // =====================================================
  // CORS — ALLOW ALL STORYBOUND DEPLOYMENTS
  // =====================================================
  const origin = req.headers.origin || "";

  const allowed =
    origin === "https://storybound-app.vercel.app" ||
    /^https:\/\/storybound(-app)?-[a-z0-9-]+\.vercel\.app$/.test(origin);

  res.setHeader("Access-Control-Allow-Origin", allowed ? origin : "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    // IMPORTANT: 204 avoids Vercel CORS weirdness
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const isImageRequest = url.pathname.endsWith("/image");

    // =====================================================
    // IMAGE PASSTHROUGH (Perchance / Gemini / OpenAI)
    // =====================================================
    if (isImageRequest) {
      // Forward EXACTLY as-is to storybound-app image endpoint
      const imageRes = await fetch(
        "https://storybound-app.vercel.app/api/image",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": req.headers.authorization || ""
          },
          body: JSON.stringify(req.body)
        }
      );

      const text = await imageRes.text();
      res.status(imageRes.status).send(text);
      return;
    }

    // =====================================================
    // CHAT (GROK)
    // =====================================================
    const { messages, model, temperature, max_tokens } = req.body || {};

    if (!Array.isArray(messages)) {
      throw new Error("Invalid messages payload");
    }

    const XAI_API_KEY =
      process.env.XAI_API_KEY || process.env.GROK_API_KEY;

    if (!XAI_API_KEY) {
      throw new Error("XAI_API_KEY not set");
    }

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

    if (!data?.choices?.[0]?.message?.content) {
      throw new Error("INVALID_MODEL_RESPONSE_SHAPE");
    }

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
