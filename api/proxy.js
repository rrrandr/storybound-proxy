export default function handler(req, res) {
  // ----- CORS / PREFLIGHT (HARD STOP) -----
  res.setHeader('Access-Control-Allow-Origin', 'https://storybound-app.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // If browser is asking "may I send a POST?"
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
// NEVER CHANGE OR DELETE ANYTHING ABOVE
  

