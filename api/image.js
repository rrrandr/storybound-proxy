import axios from 'axios';

export default async function handler(req, res) {
  // ----- CORS -----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ----- INPUT -----
  // Important: strip size out so it cannot be forwarded to Grok accidentally via ...rest
  const body = (req.body || {});
  const { prompt, model, size, ...restRaw } = body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing required field: prompt' });
    return;
  }

  // Remove size if someone included it inside rest (defensive)
  // eslint-disable-next-line no-unused-vars
  const { size: _ignoredSize, ...rest } = restRaw;

  // Front-end passes size sometimes; keep for providers that support it (OpenAI)
  const requestedSize = size || '1024x1024';

  // ----- PROVIDER CONFIG -----
  // Accept either GROK_API_KEY or XAI_API_KEY (your screenshot shows XAI_API_KEY)
  const GROK_API_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // You can override model from client, otherwise default:
  const grokModel = model || 'grok-2-image-1212';

  // Helper: simple retry wrapper
  async function withRetry(fn, { tries = 2, delayMs = 600 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn(i);
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
    throw lastErr;
  }

  // Normalize error message for UI
  function errMsg(e) {
    const data = e?.response?.data;
    if (typeof data === 'string') return data;
    if (data?.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    if (data?.message) return data.message;
    return e?.message || 'Unknown error';
  }

  // ----- 1) GROK IMAGE -----
  async function tryGrok() {
    if (!GROK_API_KEY) throw new Error('GROK_API_KEY (or XAI_API_KEY) not set');

    // xAI images endpoint
    const url = 'https://api.x.ai/v1/images/generations';

    // IMPORTANT: Grok rejects "size" (your error proves it). So do NOT send size.
    // Also avoid passing any unknown image params unless you know xAI supports them.
    const payload = {
      model: grokModel,
      prompt,
      ...rest
    };

    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    const data = resp.data || {};

    // Support a few common return shapes
    if (data.image && typeof data.image === 'string') {
      return { image: data.image, promptUsed: data.promptUsed || prompt, provider: 'grok' };
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (b64) {
      return { image: `data:image/png;base64,${b64}`, promptUsed: data.promptUsed || prompt, provider: 'grok' };
    }

    const b64alt = data?.data?.[0]?.b64;
    if (b64alt) {
      return { image: `data:image/png;base64,${b64alt}`, promptUsed: data.promptUsed || prompt, provider: 'grok' };
    }

    const urlImg = data?.data?.[0]?.url;
    if (urlImg) {
      return { image: urlImg, promptUsed: data.promptUsed || prompt, provider: 'grok' };
    }

    throw new Error('Grok returned no image payload');
  }

  // ----- 2) OPENAI IMAGE (fallback) -----
  async function tryOpenAI() {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

    const url = 'https://api.openai.com/v1/images/generations';

    const resp = await axios.post(
      url,
      {
        // model: 'gpt-image-1', // set later when you add OPENAI_API_KEY
        prompt,
        size: requestedSize,
        response_format: 'b64_json'
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const b64 = resp?.data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image payload');
    return { image: `data:image/png;base64,${b64}`, promptUsed: prompt, provider: 'openai' };
  }

  // ----- 3) GEMINI IMAGE (fallback) -----
  async function tryGemini() {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    throw new Error('Gemini image fallback not wired yet (needs endpoint/payload)');
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
          error: 'All image providers failed',
          details: {
            grok: errMsg(grokErr),
            openai: errMsg(openaiErr),
            gemini: errMsg(geminiErr)
          }
        });
      }
    }
  }
}
