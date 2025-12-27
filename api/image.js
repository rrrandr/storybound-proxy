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
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    // Leave cleanly wired for now so you get a readable error.
    throw new Error("Gemini image fallback not implemented yet");
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
