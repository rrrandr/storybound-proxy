import axios from 'axios';

export default async function handler(req, res) {
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

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Proxy error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Proxy error',
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
