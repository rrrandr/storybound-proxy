// api/image.js
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  // ----- CORS / PREFLIGHT -----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ----- INPUT -----
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const model = typeof body.model === "string" ? body.model : ""; // optional
  const size = typeof body.size === "string" ? body.size : "1024x1024";

  if (!prompt.trim()) return res.status(400).json({ error: "Missing required field: prompt" });

  const requestId = crypto.randomUUID();
  res.setHeader("x-storybound-request-id", requestId);

  // ----- KEYS -----
  // Put ONE of these in Vercel env vars for the proxy project
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY not set on proxy project", requestId });
  }

  // ----- CALL OPENAI IMAGES API -----
  try {
    // Use global fetch (Node 18+). No axios needed.
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "gpt-image-1",
        prompt,
        size,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(502).json({
        error: "OpenAI image generation failed",
        requestId,
        details: data,
      });
    }

    // data.data[0].b64_json OR data.data[0].url depending on model/settings
    return res.status(200).json({ requestId, ...data });
  } catch (e) {
    return res.status(502).json({
      error: "Image proxy request failed",
      requestId,
      message: e?.message || String(e),
    });
  }
};
