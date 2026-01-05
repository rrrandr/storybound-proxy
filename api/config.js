export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const SUPABASE_URL = process.env.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
  const PROXY_URL = process.env.PROXY_URL || "";
  const IMAGE_PROXY_URL = process.env.IMAGE_PROXY_URL || "";

res.status(200).json({
    has_SUPABASE_URL: !!process.env.SUPABASE_URL,
    has_SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    has_PROXY_URL: !!process.env.PROXY_URL,
    has_IMAGE_PROXY_URL: !!process.env.IMAGE_PROXY_URL,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    proxyUrl: PROXY_URL,
    imageProxyUrl: IMAGE_PROXY_URL,
});
}
 
