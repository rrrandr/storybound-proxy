import axios from "axios";

export default async function handler(req, res) {
  // ----- CORS -----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ----- INPUT -----
  const body = req.body || {};
  const { prompt, provider, model, size, n, ...restRaw } = body;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing required field: prompt" });
  }

  // Strip size from rest no matter what
  // eslint-disable-next-line no-unused-vars
  const { size: _ignoredSize, ...rest } = restRaw;

  const requestedSize = size || "1024x1024";

  // ----- KEYS -----
  const GROK_API_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // Defaults
  const grokModelDefault = "grok-2-image-1212";
  const openaiModelDefault = "gpt-image-1";
  const geminiModelDefault = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

  // ----- HELPERS -----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function withRetry(fn, { tries = 2, delayMs = 600 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn(i);
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await sleep(delayMs * (i + 1));
      }
    }
    throw lastErr;
  }

  function errMsg(e) {
    const data = e?.response?.data;
    if (typeof data === "string") return data;
    if (data?.error) return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    if (data?.message) return data.message;
    return e?.message || "Unknown error";
  }

  /**
   * Normalize ALL providers to:
   * {
   *   provider: 'grok'|'openai'|'gemini',
   *   promptUsed: string,
   *   url: string,               // remote URL or data URI
   *   data: [{ url?: string, b64_json?: string }]
   * }
   */
  function ok({ providerName, promptUsed, url, b64_json, mimeType = "image/png" }) {
    const finalUrl = url || (b64_json ? `data:${mimeType};base64,${b64_json}` : undefined);
    if (!finalUrl) throw new Error("ok() called without url or b64_json");

    return {
      provider: providerName,
      promptUsed: promptUsed || prompt,
      url: finalUrl,
      data: [{ url: finalUrl, ...(b64_json ? { b64_json } : {}) }],
    };
  }

  // Map common size strings to Gemini aspect ratios
  const sizeToAspect = (s) => {
    const map = {
      "1024x1024": "1:1",
      "512x512": "1:1",
      "1536x1024": "3:2",
      "1024x1536": "2:3",
      "1344x768": "16:9",
      "768x1344": "9:16",
    };
    return map[s] || "1:1";
  };

  // ----- PROVIDERS -----

  async function tryGrok() {
    if (!GROK_API_KEY) throw new Error("GROK_API_KEY (or XAI_API_KEY) not set");

    const url = "https://api.x.ai/v1/images/generations";

    // IMPORTANT: do NOT send `size` to xAI.
    const payload = {
      model: model || grokModelDefault,
      prompt,
      ...(n ? { n } : {}),
      ...rest, // any other supported knobs
    };

    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${GROK_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
      validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`xAI ${resp.status}: ${errMsg({ response: resp })}`);
    }

    const data = resp.data || {};
    const b64 = data?.data?.[0]?.b64_json || data?.data?.[0]?.b64;
    const imgUrl = data?.data?.[0]?.url;

    if (imgUrl) return ok({ providerName: "grok", promptUsed: data.promptUsed || prompt, url: imgUrl });
    if (b64) return ok({ providerName: "grok", promptUsed: data.promptUsed || prompt, b64_json: b64, mimeType: "image/png" });

    // Some alt shapes
    if (typeof data.image === "string") {
      const v = data.image;
      if (v.startsWith("http")) return ok({ providerName: "grok", promptUsed: data.promptUsed || prompt, url: v });
      if (v.startsWith("data:image/")) {
        const split = v.split("base64,");
        if (split.length === 2) return ok({ providerName: "grok", promptUsed: data.promptUsed || prompt, b64_json: split[1], mimeType: "image/png" });
      }
    }

    throw new Error("Grok returned no image payload (no url/b64_json)");
  }

  async function tryOpenAI() {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

    // Allow override via `model` but default to gpt-image-1
    const openaiModel = model || openaiModelDefault;

    const url = "https://api.openai.com/v1/images/generations";

    const resp = await axios.post(
      url,
      {
        model: openaiModel,
        prompt,
        size: requestedSize,
        response_format: "b64_json",
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
        validateStatus: () => true,
      }
    );

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`OpenAI ${resp.status}: ${errMsg({ response: resp })}`);
    }

    const b64 = resp?.data?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI returned no image payload (no b64_json)");

    return ok({ providerName: "openai", promptUsed: prompt, b64_json: b64, mimeType: "image/png" });
  }

  async function tryGemini() {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

    // Allow override via `model` but default to env or gemini-2.5-flash-image
    const geminiModel = model || geminiModelDefault;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      geminiModel
    )}:generateContent`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: sizeToAspect(requestedSize) },
      },
    };

    const resp = await axios.post(url, payload, {
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 60000,
      validateStatus: () => true,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Gemini ${resp.status}: ${errMsg({ response: resp })}`);
    }

    const data = resp.data || {};
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const inline = parts.find((p) => p.inlineData && p.inlineData.data);

    if (inline?.inlineData?.data) {
      const mime = inline.inlineData.mimeType || "image/png";
      return ok({
        providerName: "gemini",
        promptUsed: prompt,
        b64_json: inline.inlineData.data,
        mimeType: mime,
      });
    }

    const textPart = parts.find((p) => typeof p.text === "string" && p.text.trim());
    if (textPart?.text) {
      throw new Error(`Gemini returned text but no image: ${textPart.text.slice(0, 200)}`);
    }

    throw new Error("Gemini returned no image payload");
  }

  // ----- ROUTING -----
  // provider can be: "xai"|"grok"|"openai"|"gemini"|"google"
  const p = (provider || "").toLowerCase().trim();

  try {
    // Explicit provider selection (no fallback)
    if (p === "xai" || p === "grok") {
      const r = await withRetry(() => tryGrok(), { tries: 2, delayMs: 700 });
      return res.status(200).json(r);
    }
    if (p === "openai") {
      const r = await withRetry(() => tryOpenAI(), { tries: 2, delayMs: 700 });
      return res.status(200).json(r);
    }
    if (p === "gemini" || p === "google") {
      const r = await withRetry(() => tryGemini(), { tries: 1, delayMs: 700 });
      return res.status(200).json(r);
    }

    // No provider → fallback chain (your original behavior)
    try {
      const grokResult = await withRetry(() => tryGrok(), { tries: 2, delayMs: 700 });
      return res.status(200).json(grokResult);
    } catch (grokErr) {
      try {
        const openaiResult = await withRetry(() => tryOpenAI(), { tries: 2, delayMs: 700 });
        return res.status(200).json(openaiResult);
      } catch (openaiErr) {
        try {
          const geminiResult = await withRetry(() => tryGemini(), { tries: 1, delayMs: 700 });
          return res.status(200).json(geminiResult);
        } catch (geminiErr) {
          return res.status(502).json({
            error: "All image providers failed",
            details: {
              grok: errMsg(grokErr),
              openai: errMsg(openaiErr),
              gemini: errMsg(geminiErr),
            },
          });
        }
      }
    }
  } catch (e) {
    return res.status(500).json({ error: errMsg(e) });
  }
}
