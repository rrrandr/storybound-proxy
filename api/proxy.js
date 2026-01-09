export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://storybound-app.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ACCEPT POST AND RETURN ECHO
if (req.method === "POST") {
  const { messages, model, temperature, max_tokens } = req.body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid messages payload" });
  }

  const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!XAI_API_KEY) {
    return res.status(500).json({ error: "XAI_API_KEY not set" });
  }

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model || "grok-4-1-fast-reasoning",
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: max_tokens ?? 800
    })
  });

  const data = await response.json();
  return res.status(200).json(data);
}

  return res.status(405).json({ error: "Method not allowed" });
}
