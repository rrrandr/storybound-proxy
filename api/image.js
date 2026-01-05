// api/image.js
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const requestId = crypto.randomUUID();
  res.setHeader("x-storybound-request-id", requestId);

  try {
    const body = req.body || {};
    const prompt = body.prompt;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing required field: prompt", requestId });
    }

    // Example placeholder response (so endpoint works while you wire providers)
    // Replace with your provider code later.
    return res.status(200).json({
      id: "image_placeholder",
      requestId,
      ok: true,
      message: "Image endpoint is alive. Wire providers next.",
      received: { model: body.model || null, size: body.size || null }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Unknown error", requestId });
  }
};
