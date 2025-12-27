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
  const { prompt, model, size, ...rest } = (req.body || {});
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing required field: prompt' });
    return;
  }

  // Your front-end passes size sometimes; default if missing:
  const requestedSize = size || '1024x1024';

  // ----- PROVIDER CONFIG -----
  const GROK_API_KEY = process.env.GROK_API_KEY;
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
        // small backoff
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
    if (!GROK_API_KEY) throw new Error('GROK_API_KEY not set');

    // NOTE: Replace URL if your Grok image endpoint differs.
    // This is a placeholder that matches the "send prompt + model" pattern you’ve been using.
    const url = 'https://api.x.ai/v1/images/generations';

    const resp = await axios.post(
      url,
      {
        model: grokModel,
        prompt,
        size: requestedSize,
        ...rest
      },
      {
        headers: {
          Authorization: `Bearer ${GROK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    // Expect either { image: 'data-url' } OR OpenAI-like { data:[{b64_json}] }
    const data = resp.data || {};
    if (data.image && typeof data.image === 'string') {
      return { image: data.image, promptUsed: data.promptUsed || prompt, provider: 'grok' };
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (b64) {
      return { image: `data:image/png;base64,${b64}`, promptUsed: data.promptUsed || prompt, provider: 'grok' };
    }

    throw new Error('Grok returned no image payload');
  }

  // ----- 2) OPENAI IMAGE (fallback) -----
  async function tryOpenAI() {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

    // This is the modern OpenAI Images endpoint pattern.
    // If you later want me to pin exact models + payload to current docs, tell me which OpenAI model you plan to use.
    const url = 'https://api.openai.com/v1/images/generations';

    const resp = await axios.post(
      url,
      {
        // model: 'gpt-image-1', // example; set later
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

    // Gemini image generation APIs vary by product/version.
    // This is a placeholder stub wired for later—won’t run until you fill the correct endpoint/payload.
    throw new Error('Gemini image fallback not wired yet (needs endpoint/payload)');
  }

  // ----- EXECUTION: retry + fallback chain -----
  try {
    // Try Grok with retries first
    const grokResult = await withRetry(() => tryGrok(), { tries: 2, delayMs: 700 });
    res.status(200).json(grokResult);
    return;
  } catch (grokErr) {
    // Grok failed, try OpenAI
    try {
      const openaiResult = await withRetry(() => tryOpenAI(), { tries: 2, delayMs: 700 });
      res.status(200).json(openaiResult);
      return;
    } catch (openaiErr) {
      // OpenAI failed, try Gemini
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
