export default function handler(req, res) {
  // ----- CORS / PREFLIGHT (HARD STOP) -----
  res.setHeader('Access-Control-Allow-Origin', 'https://storybound-app.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // If browser is asking "may I send a POST?"
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
// NEVER CHANGE OR DELETE ANYTHING ABOVE
  
// api/proxy.js  (Vercel Serverless Function, Node 24, ESM)

import axios from "axios";
import crypto from "crypto";

export default async function handler(req, res) {
  try {
    // ----- CORS / PREFLIGHT -----
    res.setHeader('Access-Control-Allow-Origin', 'https://storybound-app.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ----- KEYS -----
    const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!XAI_API_KEY && !GEMINI_API_KEY && !OPENAI_API_KEY) {
      throw new Error('No LLM API key configured');
    }

    // ----- COST GUARDS -----
    const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 60000);
    const MAX_MESSAGES = Number(process.env.MAX_MESSAGES || 24);
    const MAX_CHARS_PER_MESSAGE = Number(process.env.MAX_CHARS_PER_MESSAGE || 3200);
    const MAX_TOTAL_INPUT_CHARS = Number(process.env.MAX_TOTAL_INPUT_CHARS || 18000);
    const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 900);

    const GEMINI_FALLBACK_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const OPENAI_FALLBACK_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // ----- Helpers -----
    function errMsg(e) {
      const data = e?.response?.data;
      if (!data) return e?.message || 'Unknown error';
      if (typeof data === 'string') return data;
      if (data?.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
      if (data?.message) return data.message;
      return JSON.stringify(data);
    }

    function safeJsonBody(raw) {
      if (!raw) return {};
      if (typeof raw === 'object') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }

    // ---- TEMP: confirm proxy is alive ----
    return res.status(200).json({ ok: true });

    // (Your real proxy logic goes here next)

  } catch (err) {
    console.error('PROXY ERROR:', err);
    return res.status(500).json({
      error: 'Proxy failed',
      message: err.message || String(err)
    });
  }
}


  function sanitizeChatBody(bodyRaw) {
    const body = bodyRaw && typeof bodyRaw === "object" ? bodyRaw : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const sliced = messages.slice(Math.max(0, messages.length - MAX_MESSAGES));

    const clamped = sliced.map((m) => ({
      role: m?.role || "user",
      content: clampText(m?.content, MAX_CHARS_PER_MESSAGE),
    }));

    let total = clamped.reduce((sum, m) => sum + (m.content?.length || 0), 0);

    let out = clamped;
    if (total > MAX_TOTAL_INPUT_CHARS) {
      out = [...clamped];
      while (out.length > 1 && total > MAX_TOTAL_INPUT_CHARS) {
        const removed = out.shift();
        total -= removed?.content?.length || 0;
      }
    }

    const max_tokens = Math.min(
      Number.isFinite(body.max_tokens) ? body.max_tokens : MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS
    );

    return { ...body, messages: out, max_tokens };
  }

  function toGeminiRequest(body) {
    const { messages, temperature, top_p } = body || {};
    const sysTexts = [];
    const contents = [];

    const msgs = Array.isArray(messages) ? messages : [];
    for (const m of msgs) {
      const role = m?.role;
      const content = typeof m?.content === "string" ? m.content : "";
      if (!content) continue;

      if (role === "system") {
        sysTexts.push(content);
        continue;
      }

      const geminiRole = role === "assistant" ? "model" : "user";
      contents.push({ role: geminiRole, parts: [{ text: content }] });
    }

    if (contents.length === 0 && typeof body?.prompt === "string" && body.prompt.trim()) {
      contents.push({ role: "user", parts: [{ text: body.prompt.trim() }] });
    }

    const reqBody = {
      contents,
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    };

    if (sysTexts.length) {
      reqBody.systemInstruction = { parts: [{ text: sysTexts.join("\n\n") }] };
    }

    if (typeof temperature === "number") reqBody.generationConfig.temperature = temperature;
    if (typeof top_p === "number") reqBody.generationConfig.topP = top_p;

    return { geminiModel: GEMINI_FALLBACK_MODEL, reqBody };
  }

  function fromGeminiToChatCompletions(geminiResp, modelName) {
    const data = geminiResp?.data || {};
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("") || "";

    return {
      id: "gemini_fallback",
      object: "chat.completion",
      model: modelName,
      choices: [
        { index: 0, message: { role: "assistant", content: text || "" }, finish_reason: "stop" },
      ],
    };
  }

  function fromOpenAIToChatCompletions(openaiResp, modelName) {
    const data = openaiResp?.data || {};
    const text = data?.choices?.[0]?.message?.content || "";
    return {
      id: data?.id || "openai_fallback",
      object: "chat.completion",
      model: modelName,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text || "" },
          finish_reason: data?.choices?.[0]?.finish_reason || "stop",
        },
      ],
    };
  }

  // ----- MAIN -----
  const requestId = crypto.randomUUID();

  const rawBody = safeJsonBody(req.body);
  const safeBody = sanitizeChatBody(rawBody);

  // If you want an "alive" check, allow empty body:
  if (!safeBody?.messages || !Array.isArray(safeBody.messages) || safeBody.messages.length === 0) {
    setDebugHeaders({ provider: "none", model: "none", requestId });
    return res.status(200).json({ ok: true, message: "proxy endpoint is alive", requestId });
  }

  // 1) xAI
  try {
    if (!XAI_API_KEY) throw new Error("XAI_API_KEY (or GROK_API_KEY) not set");

    const xaiModel = safeBody?.model || "grok-4-1-fast-reasoning";
    setDebugHeaders({ provider: "xai", model: xaiModel, requestId });

    const xaiResp = await postWithTimeout(
      "https://api.x.ai/v1/chat/completions",
      safeBody,
      {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      }
    );

    return res.status(200).json(xaiResp.data);
  } catch (xaiErr) {
    // 2) Gemini
    try {
      if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

      const { geminiModel, reqBody } = toGeminiRequest(safeBody);
      setDebugHeaders({ provider: "gemini", model: geminiModel, requestId });

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        geminiModel
      )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

      const geminiResp = await postWithTimeout(geminiUrl, reqBody, {
        "Content-Type": "application/json",
        Accept: "application/json",
      });

      return res.status(200).json(fromGeminiToChatCompletions(geminiResp, geminiModel));
    } catch (geminiErr) {
      // 3) OpenAI
      try {
        if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

        setDebugHeaders({ provider: "openai", model: OPENAI_FALLBACK_MODEL, requestId });

        const openaiResp = await postWithTimeout(
          "https://api.openai.com/v1/chat/completions",
          {
            model: OPENAI_FALLBACK_MODEL,
            messages: safeBody.messages,
            temperature: safeBody.temperature,
            top_p: safeBody.top_p,
            max_tokens: safeBody.max_tokens,
          },
          {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          }
        );

        return res.status(200).json(fromOpenAIToChatCompletions(openaiResp, OPENAI_FALLBACK_MODEL));
      } catch (openaiErr) {
        return res.status(502).json({
          error: "All providers failed",
          requestId,
          details: {
            xai: errMsg(xaiErr),
            gemini: errMsg(geminiErr),
            openai: errMsg(openaiErr),
          },
        });
      }
    }
  }
}
