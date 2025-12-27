import axios from "axios";

export default async function handler(req, res) {
  // ----- CORS -----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // ----- INPUT -----
  const body = req.body || {};
  const { prompt, model, size, ...restRaw } = body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing required field: prompt" });
    return;
  }

  // Defensive: strip "size" even if nested
  // eslint-disable-next-line no-unused-vars
  const { size: _ignoredSize, ...rest } = restRaw;

  const requestedSize = size || "1024x1024";

  // ----- PROVIDER CONFIG -----
  const GROK_API_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  const grokModel = model || "grok-2-image-1212";
  const openaiModel = "gpt-image-1"; // required if you use OpenAI fallback

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
   * Normalize to the SAME shape your frontend already handles:
   * {
   *   provider: 'grok' | 'openai' | 'gemini',
   *   promptUsed: string,
   *   data: [{ url?: string, b64_json?: string }]
   * }
   */
  function ok({ provider, promptUsed, url, b64_json }) {
    return {
      provider,
      promptUsed: promptUsed || prompt,
      data: [
        {
          ...(url ? { url } : {}),
          ...(b64_json ? { b64_json } : {}),
        },
      ],
    };
  }

  // ----- 1) GROK IMAGE -----
  async function tryGrok() {
    if (!GROK_API_KEY) throw new Error("GROK_API_KEY (or XAI_API_KEY) not set");

    const url = "https://api.x.ai/v1/images/generations";

    // IMPORTANT: do NOT send `size` to xAI.
    const payload = {
      model: grokModel,
      prompt,
      ...rest,
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

    // Common shapes
    const b64 = data?.data?.[0]?.b64_json || data?.data?.[0]?.b64;
    const imgUrl = data?.data?.[0]?.url;

    if (imgUrl) {
      return ok({ provider: "grok", promptUsed: data.promptUsed || prompt, url: imgUrl });
    }
    if (b64) {
      return ok({ provider: "grok", promptUsed: data.promptUsed || prompt, b64_json: b64 });
    }

    // Some older/alt shapes
    if (typeof data.image === "string") {
      const v = data.image;
      if (v.startsWith("http")) {
        return ok({ provider: "grok", promptUsed: data.promptUsed || prompt, url: v });
      }
      // could be data URI
      if (v.startsWith("data:image/")) {
        const split = v.split("base64,");
        if (split.length === 2) {
          return ok({ provider: "grok", promptUsed: data.promptUsed || prompt, b64_json: split[1] });
        }
      }
    }

    throw new Error("Grok returned no image payload (no url/b64_json)");
  }

  // ----- 2) OPENAI IMAGE (fallback) -----
  async function tryOpenAI() {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

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

    return ok({ provider: "openai", promptUsed: prompt, b64_json: b64 });
  }

// ----- 3) GEMINI IMAGE (fallback) -----
async function tryGemini() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

  // Models per Google docs:
  // - Fast: gemini-2.5-flash-image
  // - Higher-end: gemini-3-pro-image-preview
  // Default to the fast one unless you override via env.
  const geminiModel =
    process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel
  )}:generateContent`;

  // Map your requestedSize (e.g. "1024x1024") to an aspect ratio
  // Gemini image REST supports imageConfig.aspectRatio (ex: "16:9"). :contentReference[oaicite:2]{index=2}
  const sizeToAspect = (s) => {
    const map = {
      '1024x1024': '1:1',
      '512x512': '1:1',
      '1536x1024': '3:2',
      '1024x1536': '2:3',
      '1344x768': '16:9',
      '768x1344': '9:16',
    };
    return map[s] || '1:1';
  };

  const payload = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      // If you want ONLY an image back, uncomment responseModalities.
      // responseModalities: ["Image"],
      imageConfig: {
        aspectRatio: sizeToAspect(requestedSize),
      },
    },
  };

  const resp = await axios.post(url, payload, {
    headers: {
      'x-goog-api-key': GEMINI_API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  const data = resp.data || {};

  // Gemini returns candidates[0].content.parts, with inlineData for images. :contentReference[oaicite:3]{index=3}
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p) => p.inlineData && p.inlineData.data);

  if (inline?.inlineData?.data) {
    const mime = inline.inlineData.mimeType || 'image/png';
    return {
      image: `data:${mime};base64,${inline.inlineData.data}`,
      promptUsed: prompt,
      provider: 'gemini',
      model: geminiModel,
    };
  }

  // Sometimes you may also get text parts alongside/without images
  const textPart = parts.find((p) => typeof p.text === 'string' && p.text.trim());
  if (textPart?.text) {
    throw new Error(`Gemini returned text but no image: ${textPart.text.slice(0, 200)}`);
  }

  throw new Error('Gemini returned no image payload');
}


  // ----- EXECUTION: retry + fallback chain -----
  try {
    const grokResult = await withRetry(() => tryGrok(), { tries: 2, delayMs: 700 });
    res.status(200).json(grokResult);
    return;
  } catch (grokErr) {
    try {
      const openaiResult = await withRetry(() => tryOpenAI(), { tries: 2, delayMs: 700 });
      res.status(200).json(openaiResult);
      return;
    } catch (openaiErr) {
      try {
        const geminiResult = await withRetry(() => tryGemini(), { tries: 1, delayMs: 700 });
        res.status(200).json(geminiResult);
        return;
      } catch (geminiErr) {
        res.status(502).json({
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
}
