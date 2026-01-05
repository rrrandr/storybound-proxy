// api/image.js

module.exports = async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // TEMP: prove CORS + route are working
  // (Once this works, replace with your real image provider code.)
  const { prompt = "", size = "1024x1024" } = req.body || {};
  return res.status(200).json({
    ok: true,
    message: "image endpoint is alive",
    prompt,
    size,
  });
};
