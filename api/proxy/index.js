import axios from "axios";

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

  // ----- HELPERS -----
  const timeoutMs = 60000;

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

  // Convert OpenAI/xAI-style {messages:[{role,content}]} into Gemini {contents, systemInstruction}
  function toGeminiRequest(body) {
    const { messages, temperature, top_p, max_tokens } = body || {};

    // HARDCODED: Always use Flash for fallback so Grok model names never leak into Gemini
    const geminiModel = "gemini-2.0-flash";

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

      // Gemini chat roles are typically "user" and "model"
      const geminiRole = role === "assistant" ? "model" : "user";
      contents.push({
        role: geminiRole,
        parts: [{ text: content }],
      });
    }

    // Defensive fallback
    if (contents.length === 0 && typeof body?.prompt === "string" && body.prompt.trim()) {
      contents.push({ role: "user", parts: [{ text: body.prompt.trim() }] });
    }

    const reqBody = {
      contents,
      generationConfig: {},
    };

    if (sysTexts.length) {
      reqBody.systemInstruction = {
        parts: [{ text: sysTexts.join("\n\n") }],
      };
    }

    // Optional mappings (safe to omit if you want)
    if (typeof temperature === "number") reqBody.generationConfig.temperature = temperature;
    if (typeof top_p === "number") reqBody.generationConfig.topP = top_p;
    if (typeof max_tokens === "number") reqBody.generationConfig.maxOutputTokens = max_tokens;

    return { geminiModel, reqBody };
  }

  // Convert Gemini response into an OpenAI/xAI-ish chat.completions shape (NO gemini_raw)
  function fromGeminiToChatCompletions(geminiResp, modelName = "gemini") {
    const data = geminiResp?.data || {};
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join("") || "";

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

  // ----- 1) TRY xAI FIRST -----
  try {
    if (!XAI_API_KEY) throw new Error("XAI_API_KEY (or GROK_API_KEY) not set");

    const xaiResp = await postWithTimeout(
      "https://api.x.ai/v1/chat/completions",
      req.body,
      {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      }
    );

    res.status(200).json(xaiResp.data);
    return;
  } catch (xaiErr) {
    // ----- 2) FALLBACK TO GEMINI -----
    try {
      if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

      const { geminiModel, reqBody } = toGeminiRequest(req.body);

      // AI Studio REST endpoint
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        geminiModel
      )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

      // Add Accept header (nice-to-have)
      const geminiResp = await postWithTimeout(geminiUrl, reqBody, {
        "Content-Type": "application/json",
        Accept: "application/json",
      });

      res.status(200).json(fromGeminiToChatCompletions(geminiResp, geminiModel));
      return;
    } catch (geminiErr) {
      res.status(502).json({
        error: "All providers failed",
        details: {
          xai: errMsg(xaiErr),
          gemini: errMsg(geminiErr),
        },
      });
    }
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
