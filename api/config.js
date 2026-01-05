export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    proxyUrl: process.env.STORY_PROXY_URL || "",
    imageProxyUrl: process.env.IMAGE_PROXY_URL || "",
  });
}
