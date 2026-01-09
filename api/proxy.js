// api/proxy.js — minimal, crash-proof

export default async function handler(req, res) {
  try {
    // ----- CORS / PREFLIGHT -----
    res.setHeader("Access-Control-Allow-Origin", "https://storybound-app.vercel.app");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};

return res.status(200).json({
  ok: true,
  received: body
});
  
  } catch (err) {
    return res.status(500).json({
      error: "Proxy crashed",
      message: String(err),
    });
  }
}
