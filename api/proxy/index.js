import axios from "axios";
import crypto from "crypto";

export default async function handler(req, res) {
  // ----- CORS / PREFLIGHT -----
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

  // ----- KEYS -----
  const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Google AI Studio key
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // OpenAI key (optional third fallback)

  // ----- COST GUARDS (tune via env if you want) -----
  const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 60000);

  // Biggest cost lever: cap the amount of history you forward
  const MAX_MESSAGES = Number(process.env.MAX_MESSAGES || 24);            // keep last N messages
  const MAX_CHARS_PER_MESSAGE = Number(process.env.MAX_CHARS_PER_MESSAGE || 3200);
  const MAX_TOTAL_INPUT_CHARS = Number(process.env.MAX_TOTAL_INPUT_CHARS || 18000);

  // Second biggest cost lever: cap output tokens
  const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 900);

  // Force cheap fallback models (recommended)
  const GEMINI_FALLBACK_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const OPENAI_FALLBACK_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // ----- HELPERS -----
  function errMsg(e) {
    const data = e?.response?.data;
    if (!data) return e?.message || "Unknown error";
    if (typeof data === "string") return data;
    if (data?.error) return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
    if (data?.message) return data.message;
    return JSON.stringify(data);
  }

  async function postWithTimeout(url, payload, headers) {
    return axios.post(url, payload, { headers, timeout: timeoutMs });
  }

  function setDebugHeaders({ provider, model, requestId }) {
    res.setHeader("x-storybound-provider", provider);
    res.setHeader("x-storybound-model", model);
    res.setHeader("x-storybound-request-id", requestId);
  }

  // ---- Cost guard: sanitize + clamp request body ----
  function clampText(s, max) {
    const t = typeof s === "string" ? s : "";
    if (t.length <= max) return t;
    // keep the tail (most relevant for stories)
    return t.slice(t.length - max);
  }

  function sanitizeChatBody(bodyRaw) {
    const body = bodyRaw && typeof bodyRaw === "object" ? bodyRaw : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];

    // keep last N messages
    const sliced = messages.slice(Math.max(0, messages.length - MAX_MESSAGES));

    // clamp each message content
    const clamped = sliced.map((m) => ({
      role: m?.role || "user",
      content: clampText(m?.content, MAX_CHARS_PER_MESSAGE),
    }));

    // cap total input chars across all messages (keep tail)
    let total = clamped.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (total > MAX_TOTAL_INPUT_CHARS) {
      // trim from the front (oldest first) until under cap
      const out = [...clamped];
      while (out.length > 1 && total > MAX_TOTAL_INPUT_CHARS) {
        const removed = out.shift();
        total -= removed?.content?.length || 0;
      }
      return {
        ...body,
        messages: out,
        // override max_tokens to guard costs (xAI/OpenAI)
        max_tokens: Math.min(
          Number.isFinite(body.max_tokens) ? body.max_tokens : MAX_OUTPUT_TOKENS,
          MAX_OUTPUT_TOKENS
        ),
      };
    }

    return {
      ...body,
      messages: clamped,
      max_tokens: Math.min(
        Number.isFinite(body.max_tokens) ? body.max_tokens : MAX_OUTPUT_TOKENS,
        MAX_OUTPUT_TOKENS
      ),
    };
  }

  // Convert OpenAI/xAI-style {messages:[{role,content}]} into Gemini {contents, systemInstruction}
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

  // Convert Gemini response into an OpenAI/xAI-ish chat.completions shape
  function fromGeminiToChatCompletions(geminiResp, modelName) {
    const data = geminiResp?.data || {};
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("") || "";

    return {
      id: "gemini_fallback",
      object: "chat.completion",
      model: modelName,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text || "" },
          finish_reason: "stop",
        },
      ],
    };
  }

  // Convert OpenAI response to xAI-ish (optional, but keeps shape consistent)
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

  // ----- MAIN: xAI -> Gemini -> OpenAI -----
  const requestId = crypto.randomUUID();
  const safeBody = sanitizeChatBody(req.body);

  // 1) xAI
  try {
    if (!XAI_API_KEY) throw new Error("XAI_API_KEY (or GROK_API_KEY) not set");

    const xaiModel = safeBody?.model || "grok-4-1-fast-reasoning";
    console.log(
      JSON.stringify({ requestId, provider: "xai", model: xaiModel, at: new Date().toISOString() })
    );
    setDebugHeaders({ provider: "xai", model: xaiModel, requestId });

    const xaiResp = await postWithTimeout(
      "https://api.x.ai/v1/chat/completions",
      safeBody,
      {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      }
    );

    res.status(200).json(xaiResp.data);
    return;
  } catch (xaiErr) {
    console.warn(
      JSON.stringify({
        requestId,
        provider: "xai",
        err: errMsg(xaiErr),
        at: new Date().toISOString(),
      })
    );

    // 2) Gemini
    try {
      if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

      const { geminiModel, reqBody } = toGeminiRequest(safeBody);
      console.log(
        JSON.stringify({
          requestId,
          provider: "gemini",
          model: geminiModel,
          at: new Date().toISOString(),
        })
      );
      setDebugHeaders({ provider: "gemini", model: geminiModel, requestId });

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        geminiModel
      )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

      const geminiResp = await postWithTimeout(geminiUrl, reqBody, {
        "Content-Type": "application/json",
        Accept: "application/json",
      });

      res.status(200).json(fromGeminiToChatCompletions(geminiResp, geminiModel));
      return;
    } catch (geminiErr) {
      console.warn(
        JSON.stringify({
          requestId,
          provider: "gemini",
          err: errMsg(geminiErr),
          at: new Date().toISOString(),
        })
      );

      // 3) OpenAI (optional third fallback)
      try {
        if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

        console.log(
          JSON.stringify({
            requestId,
            provider: "openai",
            model: OPENAI_FALLBACK_MODEL,
            at: new Date().toISOString(),
          })
        );
        setDebugHeaders({ provider: "openai", model: OPENAI_FALLBACK_MODEL, requestId });

        const openaiResp = await postWithTimeout(
          "https://api.openai.com/v1/chat/completions",
          {
            model: OPENAI_FALLBACK_MODEL,
            messages: safeBody.messages,
            temperature: safeBody.temperature,
            top_p: safeBody.top_p,
            max_tokens: safeBody.max_tokens, // already clamped
          },
          {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          }
        );

        res.status(200).json(fromOpenAIToChatCompletions(openaiResp, OPENAI_FALLBACK_MODEL));
        return;
      } catch (openaiErr) {
        console.warn(
          JSON.stringify({
            requestId,
            provider: "openai",
            err: errMsg(openaiErr),
            at: new Date().toISOString(),
          })
        );

        res.status(502).json({
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

export const config = {
  api: {
    bodyParser: true,
  },
};
