export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://storybound-app.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ACCEPT POST AND RETURN ECHO
  if (req.method === "POST") {
    return res.status(200).json({
      ok: true,
      method: req.method,
      body: req.body ?? null
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
