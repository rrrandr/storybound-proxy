import axios from 'axios';

export default async function handler(req, res) {
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      req.body,
      {
        headers: {
          'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Important: Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Proxy error:', error.response?.data || error.message);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(error.response?.status || 500).json({
      error: 'Proxy error',
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
