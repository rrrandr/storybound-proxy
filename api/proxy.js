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
      return res.status(imageRes.status).send(text);
    }

    // =====================================================
    // CHAT — ROLE-BASED MODEL ROUTING (AUTHOR vs GROK)
    // =====================================================
    const { messages, role, temperature, max_tokens } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        detail: "messages must be an array"
      });
    }

    // -----------------------------------------------------
    // ROLE DEFINITIONS
    // -----------------------------------------------------
    const AUTHOR_ROLES = [
      "AUTHOR",
      "PRIMARY_AUTHOR",
      "FATE_STRUCTURAL",
      "FATE_ELEVATION"
    ];

    const GROK_ROLES = [
      "RENDERER",
      "SEX_RENDERER",
      "SPECIALIST_RENDERER"
    ];

    // =====================================================
    // AUTHOR ROLES → OpenAI (gpt-4o-mini)
    // HARD FAIL — NO GROK FALLBACK
    // =====================================================
    if (AUTHOR_ROLES.includes(role)) {
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

      if (!OPENAI_API_KEY) {
        return res.status(500).json({
          error: "AUTHOR_CONFIG_ERROR",
          detail: "OPENAI_API_KEY not set"
        });
      }

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages,
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 1000
          })
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return res.status(502).json({
          error: "AUTHOR_MODEL_FAILED",
          detail: `OpenAI HTTP ${response.status}: ${text}`
        });
      }

      const data = await response.json();

      if (!data?.choices?.[0]?.message?.content) {
        return res.status(502).json({
          error: "AUTHOR_MODEL_FAILED",
          detail: "INVALID_RESPONSE_SHAPE"
        });
      }

      return res.status(200).json({
        id: data.id || "storybound-author",
        object: "chat.completion",
        created: data.created || Math.floor(Date.now() / 1000),
        model: "gpt-4o-mini",
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
    }

    // =====================================================
    // RENDERER / SEX_RENDERER → Grok (xAI)
    // =====================================================
    if (GROK_ROLES.includes(role)) {
      const XAI_API_KEY =
        process.env.XAI_API_KEY || process.env.GROK_API_KEY;

      if (!XAI_API_KEY) {
        return res.status(500).json({
          error: "RENDERER_CONFIG_ERROR",
          detail: "XAI_API_KEY not set"
        });
      }

      const selectedModel =
        role === "RENDERER"
          ? "grok-4-fast-non-reasoning"
          : "grok-4-fast-reasoning";

      const response = await fetch(
        "https://api.x.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${XAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: selectedModel,
            messages,
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 1000
          })
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return res.status(502).json({
          error: "GROK_MODEL_FAILED",
          detail: `Grok HTTP ${response.status}: ${text}`
        });
      }

      const data = await response.json();

      if (!data?.choices?.[0]?.message?.content) {
        return res.status(502).json({
          error: "GROK_MODEL_FAILED",
          detail: "INVALID_RESPONSE_SHAPE"
        });
      }

      return res.status(200).json({
        id: data.id || "storybound-grok",
        object: "chat.completion",
        created: data.created || Math.floor(Date.now() / 1000),
        model: selectedModel,
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
    }

    // =====================================================
    // UNKNOWN ROLE → HARD FAIL
    // =====================================================
    return res.status(400).json({
      error: "INVALID_ROLE",
      detail: `Unknown role: "${role}"`
    });

  } catch (err) {
    console.error("Storybound proxy error:", err);

    return res.status(500).json({
      error: "FATE_STUMBLED",
      detail: err.message
    });
  }
}
