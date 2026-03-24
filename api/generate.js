export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic, niche, content_format, emotional_hook } = req.body;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const STABILITY_KEY = process.env.STABILITY_API_KEY;

    const imagePrompt = await generatePrompt(ANTHROPIC_KEY, topic, niche, content_format, emotional_hook);
    const imageB64 = await generateImage(STABILITY_KEY, imagePrompt);

    return res.status(200).json({
      success: true,
      thumbnails: [{
        variant: 'curiosity',
        image: 'data:image/png;base64,' + imageB64,
        overlay_text: topic.toUpperCase().split(' ').slice(0,3).join(' ') + '?'
      }]
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function generatePrompt(apiKey, topic, niche, contentFormat, emotionalHook) {
  const prompt = 'Write ONE Stability AI image prompt for a YouTube thumbnail. Topic: ' + topic + '. Style: photorealistic, 16:9, person with ' + emotionalHook + ' expression, no text in image. Return ONLY the prompt.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  if (!data.content) throw new Error('Claude error: ' + JSON.stringify(data));
  return data.content[0].text.trim();
}

async function generateImage(apiKey, prompt) {
  const params = new URLSearchParams();
  params.append('prompt', prompt);
  params.append('aspect_ratio', '16:9');
  params.append('output_format', 'png');
  params.append('style_preset', 'photographic');

  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + apiKey,
      accept: 'image/*',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Stability error: ' + res.status + ' body: ' + err.substring(0, 300));
  }

  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}
