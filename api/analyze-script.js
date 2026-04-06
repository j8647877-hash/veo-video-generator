// POST /api/analyze-script — Analyzes a video script and returns a per-scene breakdown
// with voiceover text, image prompt, video prompt, and duration for each scene.
// Uses Gemini 2.5 Pro via Vertex AI (same OAuth token auth as all other tools).
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header. Please sign in.' });
  }

  const {
    script,
    projectId,
    location = 'us-central1',
    model    = 'gemini-2.5-pro',
  } = req.body;

  if (!script || !script.trim()) {
    return res.status(400).json({ error: 'script is required.' });
  }
  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required.' });
  }

  const userPrompt = `You are a professional video production director. Analyze the following video script and break it into individual scenes.

For each scene, generate:
1. An imagePrompt: a rich, detailed prompt for AI image generation (composition, lighting, colors, mood, art style)
2. A videoPrompt: a cinematic prompt for AI video generation (camera movement, action, setting, atmosphere)
3. The voiceoverText: the exact spoken words from the script for this scene (no stage directions, no speaker labels — only what is said aloud)
4. A duration estimate in seconds based on how long the narration would take to speak at a natural pace

SCRIPT:
${script.trim()}

RULES:
- Break the script into logical, self-contained scenes (typically 3–10 scenes total)
- Image prompts must be visually descriptive: subject, composition, lighting, color palette, style, mood
- Video prompts must be cinematic: camera angle, motion, action, atmosphere, visual quality descriptors
- Voiceover text: extract ONLY the words that would be spoken aloud — no [brackets], no (parentheses), no SPEAKER labels
- Duration: estimate seconds based on natural reading pace (~130 words per minute)
- Scene numbers start at 1 and are sequential

Generate the complete scene breakdown now.`;

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      scenes: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            sceneNumber:   { type: 'NUMBER',  description: 'Sequential scene number starting at 1' },
            sceneTitle:    { type: 'STRING',  description: 'Short, descriptive title for the scene' },
            voiceoverText: { type: 'STRING',  description: 'Exact spoken words only — no stage directions or labels' },
            imagePrompt:   { type: 'STRING',  description: 'Detailed prompt for AI image generation' },
            videoPrompt:   { type: 'STRING',  description: 'Cinematic prompt for AI video generation' },
            duration:      { type: 'NUMBER',  description: 'Estimated scene duration in seconds' },
          },
          required: ['sceneNumber', 'sceneTitle', 'voiceoverText', 'imagePrompt', 'videoPrompt', 'duration'],
        },
      },
    },
    required: ['scenes'],
  };

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature:      0.7,
          maxOutputTokens:  8192,
        },
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: `Network error reaching Vertex AI: ${err.message}` });
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
    });
  }

  let result;
  try {
    result = JSON.parse(rawText);
  } catch {
    return res.status(500).json({
      error: 'Failed to parse scene breakdown JSON.',
      raw: rawText.slice(0, 300),
    });
  }

  return res.status(200).json(result);
};
