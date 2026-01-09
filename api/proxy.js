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
    id: "storybound-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "storybound-test",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            "The air between them tightened, charged with something neither was ready to name. Fate was watching. This confirms the entire Storybound pipeline is alive."
        },
        finish_reason: "stop"
      }
    ]
  });
}



  const data = await response.json();
  return res.status(200).json(data);
}

  return res.status(405).json({ error: "Method not allowed" });
}
