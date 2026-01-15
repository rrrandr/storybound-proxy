import Replicate from 'replicate';

export const config = {
  maxDuration: 120
};

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

export default async function handler(req, res) {
  // ===== CORS (MANDATORY) =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight handling (MANDATORY)
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  // ============================

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, provider, model, size = '1024x1024', n = 1 } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt required' });
  }

  const [width, height] = size.split('x').map(Number);

  try {
    // FLUX PRIMARY
    if (provider === 'flux') {
      const output = await replicate.run(
        "lucataco/flux-uncensored:4f5b1200e42d5c980a35d92a96ec5afaf488429a88eae732d9e21559a30b0c88",
        {
          input: {
            prompt,
            width: width || 1024,
            height: height || 1024,
            num_outputs: 1,
            guidance_scale: 3.5,
            num_inference_steps: 28
          }
        }
      );
      return res.json({ url: output[0] });
    }

    // PERCHANCE PROVIDER
    if (provider === 'perchance') {
      return res.status(501).json({ error: 'Perchance not configured' });
    }

    // GEMINI PROVIDER
    if (provider === 'gemini') {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${model || 'imagen-3.0-generate-002'}:generateImages?key=${process.env.GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            number_of_images: n,
            aspect_ratio: width > height ? '16:9' : '1:1'
          })
        }
      );
      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data.error?.message || 'Gemini failed');
      return res.json({ url: data.generated_images?.[0]?.image_uri });
    }

    // OPENAI LAST RESORT
    if (provider === 'openai') {
      const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: model || 'gpt-image-1',
          prompt,
          size,
          n
        })
      });
      const data = await openaiRes.json();
      if (!openaiRes.ok) throw new Error(data.error?.message || 'OpenAI failed');
      return res.json({ url: data.data?.[0]?.url, data: data.data });
    }

    return res.status(400).json({ error: `Unknown provider: ${provider}` });

  } catch (err) {
    console.error(`[${provider}] Error:`, err.message);
    return res.status(502).json({ error: err.message });
  }
}
