✅ JavaScript handler created

import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { topic, niche, content_format, emotional_hook } = req.body;

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const STABILITY_KEY = process.env.STABILITY_API_KEY;
    const SHEET_ID = process.env.SHEET_ID;
    const SHEETS_KEY = process.env.SHEETS_KEY_JSON;

    // Get access token for Google Sheets
    const sheetsKey = JSON.parse(SHEETS_KEY);
    const token = await getGoogleToken(sheetsKey);

    // Load patterns from Google Sheets
    const patterns = await loadPatterns(token, SHEET_ID, niche);
    const pattern = findPattern(patterns, niche, content_format, emotional_hook);

    if (!pattern) {
      throw new Error('No pattern found in database');
    }

    // Generate 3 variants
    const variants = ['curiosity', 'shock', 'inspiration'];
    const results = [];

    for (const variant of variants) {
      // Generate prompt via Claude
      const imagePrompt = await generatePrompt(
        ANTHROPIC_KEY, topic, niche, content_format, variant, pattern
      );

      // Generate image via Stability AI
      const imageB64 = await generateImage(STABILITY_KEY, imagePrompt);

      results.push({
        variant,
        image: `data:image/png;base64,${imageB64}`,
        overlay_text: getOverlayText(topic, variant)
      });
    }

    return res.status(200).json({ success: true, thumbnails: results });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function getGoogleToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const privateKey = serviceAccount.private_key;
  const { createSign } = await import('crypto');

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey, 'base64url');

  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function loadPatterns(token, sheetId, niche) {
  const tabName = `${niche}_patterns`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json();
  if (!data.values || data.values.length < 2) return {};

  const headers = data.values[0];
  const patterns = {};

  for (const row of data.values.slice(1)) {
    const rowDict = {};
    headers.forEach((h, i) => { rowDict[h] = row[i] || ''; });
    const patternId = rowDict.pattern_id;
    if (patternId) patterns[patternId] = rowDict;
  }

  return patterns;
}

function findPattern(patterns, niche, contentFormat, emotionalHook) {
  const exact = `${niche}_${contentFormat}_${emotionalHook}`;
  if (patterns[exact]) return patterns[exact];

  for (const p of Object.values(patterns)) {
    if (p.niche === niche && p.content_format === contentFormat) return p;
  }

  for (const p of Object.values(patterns)) {
    if (p.niche === niche) return p;
  }

  return Object.values(patterns)[0] || null;
}

async function generatePrompt(apiKey, topic, niche, contentFormat, emotionalHook, pattern) {
  const winningFormula = pattern.winning_formula || '';
  const prompt = `You are a YouTube thumbnail art director. Video topic: ${topic}. Niche: ${niche}. Format: ${contentFormat}. Hook: ${emotionalHook}. Winning formula: ${winningFormula}. Write ONE detailed Stability AI image prompt. Photorealistic. Person with ${emotionalHook} expression. No text in image. 16:9 YouTube thumbnail. Return ONLY the prompt.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  return data.content[0].text.trim();
}

async function generateImage(apiKey, prompt) {
  const FormData = (await import('formdata-node')).FormData;
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', '16:9');
  form.append('output_format', 'png');
  form.append('style_preset', 'photographic');

  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'image/*',
      ...form.headers
    },
    body: form
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stability AI error: ${res.status} ${err}`);
  }

  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

function getOverlayText(topic, variant) {
  const words = topic.toUpperCase().split(' ').slice(0, 4);
  if (variant === 'curiosity') return words.slice(0, 3).join(' ') + '?';
  if (variant === 'shock') return "YOU WON'T BELIEVE THIS";
  return words.slice(0, 3).join(' ');
}
