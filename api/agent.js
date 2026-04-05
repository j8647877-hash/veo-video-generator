// POST /api/agent — Generates a structured video production plan using Gemini 3.1 Pro.
// Uses the Gemini API with JSON structured output (responseSchema) for guaranteed plan format.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in environment variables.' });
  }

  const {
    topic,
    mode           = 'mix',   // 'images' | 'mix' | 'videos'
    sceneCount     = 5,
    style          = 'Cinematic',
    targetDuration = 60,
    context        = '',
    model          = 'gemini-3.1-pro-preview',
  } = req.body;

  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: 'topic is required.' });
  }

  const visualInstruction = {
    images: 'ALL scenes MUST use "image" as visualType. Do not use "video" for any scene.',
    videos: 'ALL scenes MUST use "video" as visualType. Do not use "image" for any scene.',
    mix:    'Mix visual types thoughtfully: use "video" for action, motion, or dynamic scenes; use "image" for atmospheric, still, or conceptual moments.',
  }[mode] || '';

  const userPrompt = `You are a professional video production director and scriptwriter.

Create a complete, detailed video production plan for the following topic.

TOPIC: ${topic.trim()}${context.trim() ? `\nADDITIONAL CONTEXT: ${context.trim()}` : ''}
VISUAL STYLE: ${style}
TARGET TOTAL DURATION: approximately ${targetDuration} seconds
NUMBER OF SCENES: exactly ${sceneCount}
VISUAL ASSET MODE: ${mode}

CRITICAL RULES:
1. ${visualInstruction}
2. The sum of all voiceDuration values must approximately equal ${targetDuration} seconds total.
3. Each individual voiceDuration must be between 4 and 20 seconds.
4. Image prompts: describe composition, lighting, color palette, mood, and art direction in rich detail.
5. Video prompts: describe camera movement, subject action, setting, cinematic atmosphere, and motion in detail.
6. Voiceover text: write only the spoken words — natural, engaging narration. No stage directions, no speaker labels, no bracketed notes.
7. Generate exactly ${sceneCount} scenes numbered sequentially from 1.

Generate the complete production plan now.`;

  // JSON schema for structured output — types must be uppercase for the Gemini API
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      title: {
        type: 'STRING',
        description: 'A compelling, specific title for the video production',
      },
      description: {
        type: 'STRING',
        description: 'A concise production overview in 2–3 sentences',
      },
      totalEstimatedDuration: {
        type: 'NUMBER',
        description: 'Total estimated duration in seconds (sum of all voiceDurations)',
      },
      scenes: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            sceneNumber:    { type: 'NUMBER', description: 'Sequential scene number starting at 1' },
            sceneTitle:     { type: 'STRING', description: 'Short descriptive title for the scene' },
            voiceoverText:  { type: 'STRING', description: 'The spoken narration text — words only, no directions' },
            voiceDuration:  { type: 'NUMBER', description: 'Estimated voiceover duration in seconds (4–20)' },
            visualType:     { type: 'STRING', description: 'Either "image" or "video" — must follow the mode rule above' },
            visualPrompt:   { type: 'STRING', description: 'Detailed, evocative generation prompt for the visual asset' },
            visualDuration: { type: 'NUMBER', description: 'Visual display duration in seconds (matches voiceDuration)' },
          },
          required: ['sceneNumber', 'sceneTitle', 'voiceoverText', 'voiceDuration', 'visualType', 'visualPrompt', 'visualDuration'],
        },
      },
    },
    required: ['title', 'description', 'totalEstimatedDuration', 'scenes'],
  };

  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema,
            temperature:      0.85,
            maxOutputTokens:  8192,
          },
        }),
      }
    );
  } catch (err) {
    return res.status(500).json({ error: `Network error reaching Gemini API: ${err.message}` });
  }

  const data = await upstream.json();

  if (!upstream.ok || data.error) {
    const msg = data.error?.message || JSON.stringify(data.error || data);
    return res.status(upstream.status || 500).json({ error: msg });
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    const reason = data?.candidates?.[0]?.finishReason;
    return res.status(500).json({
      error: reason ? `Generation stopped: ${reason}` : 'No content returned from model.',
      raw: data,
    });
  }

  let plan;
  try {
    plan = JSON.parse(rawText);
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to parse production plan JSON from model response.',
      raw: rawText.slice(0, 500),
    });
  }

  return res.status(200).json(plan);
};
