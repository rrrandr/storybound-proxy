export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    proxyUrl: process.env.PROXY_URL || "",
    imageProxyUrl: process.env.IMAGE_PROXY_URL || "",
    has_SUPABASE_URL: !!process.env.SUPABASE_URL,
    has_SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    has_PROXY_URL: !!process.env.PROXY_URL,
    has_IMAGE_PROXY_URL: !!process.env.IMAGE_PROXY_URL,
  });
}
