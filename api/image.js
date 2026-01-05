// api/image.js

module.exports = async function handler(req, res) {
  // Always set CORS first, before anything else
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  try {
    // Preflight
    if (req.method === "OPTIONS") return res.status(200).end();

    // Only allow POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // TEMP “alive” response (replace with real image code later)
    const { prompt = "", size = "1024x1024" } = req.body || {};
    return res.status(200).json({ ok: true, prompt, size });
  } catch (e) {
    // If anything crashes, still return JSON with CORS already set
    return res.status(500).json({ error: "image crashed", message: e?.message || String(e) });
  }
};
