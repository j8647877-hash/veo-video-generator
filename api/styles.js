// /api/styles — Visual style template CRUD + style analysis (merged to stay within Vercel Hobby 12-function limit)
//
// POST /api/styles?action=analyze  — analyze a video's visual style via Vertex AI Gemini
//   body: { youtubeUrl, projectId }  OR  { frames: [base64...], projectId }
//
// GET    /api/styles              — list all saved styles from GCS
// POST   /api/styles              — save a new style (body: style JSON)
// DELETE /api/styles?id=<object>  — delete a style by GCS object name

const ANALYSIS_PROMPT = `You are an expert visual style analyst specializing in replicating video aesthetics for AI image generation.

Analyze the visual rendering style of this video carefully. Focus ONLY on HOW things look (artistic technique, color, lighting, rendering), NOT on WHAT the video is about. Strip out all topic, story, character names, and content.

IMPORTANT: You must also analyze 12 individual keyframes spread throughout the video. For each keyframe, describe exactly what makes that frame visually distinctive — its composition, color use, lighting, framing, and mood. These keyframe analyses serve as visual references for recreating this style on new content.

Analyze these visual dimensions:
1. Rendering technique — 3D rendered, photorealistic, 2D illustrated, cel-shaded, mixed media, digital painting, etc.
2. Color palette — dominant colors with approximate hex values, warm/cool temperature, saturation level, contrast level
3. Color coding system — how colors are used to distinguish element types abstractly
4. Lighting style — rim lighting, volumetric, neon glow, soft ambient, hard shadows, subsurface scattering, light source direction
5. Background treatment — pure black void, gradient, detailed environment, minimal, relationship to foreground
6. Surface/floor treatment — reflective floor, textured ground, floating in void, reflection style
7. Figure/subject styling — proportions, level of stylization, skin texture detail, face detail, silhouette quality
8. Composition patterns — camera angles (eye-level, low-angle, aerial, isometric), framing, aspect ratio
9. Special effects — glow, particles, depth of field, film grain, bloom, chromatic aberration, vignette
10. Typography style — if text appears: font weight, color, effects (glow/shadow), placement
11. Signature elements — the 3-5 most distinctive visual quirks that make this style instantly recognizable
12. Keyframe-by-keyframe analysis — select 12 visually distinct moments spread across the video and analyze each individually

Return ONLY a valid JSON object with this exact structure (no markdown, no code blocks, just raw JSON):

{
  "styleName": "A descriptive name based only on visual aesthetic, not topic (e.g. 'Neon-Rim Holographic Documentary', 'Soft Watercolor Editorial', 'Dark Cinematic Realism')",
  "coreIdentity": "2-3 sentence summary of the overall aesthetic in completely topic-agnostic terms",
  "renderingTechnique": "Detailed description of the rendering method and approach",
  "colorPalette": [
    { "name": "Role description", "hex": "#RRGGBB", "role": "How and where this color is used" }
  ],
  "lightingStyle": "Detailed lighting description including source, direction, intensity, and special effects",
  "backgroundTreatment": "How backgrounds are handled — environment type, depth, relationship to subjects",
  "surfaceTreatment": "Floor or ground treatment, reflections, shadows cast",
  "figureStyle": "How subjects are rendered — detail level, proportions, stylization degree",
  "compositionPatterns": "Typical camera angles, framing preferences, depth of field usage",
  "specialEffects": "Glow, particles, blur, grain, bloom, and any other consistent effects",
  "typographyStyle": "Text rendering approach, or null if no text appears",
  "signatureElements": ["most distinctive element 1", "most distinctive element 2", "most distinctive element 3"],
  "aspectRatio": "16:9 or 9:16 or 4:3 or 1:1",
  "keyframes": [
    {
      "index": 1,
      "timestamp": "approximate timecode like 0:05 or 1:23",
      "description": "Detailed visual description of exactly what this frame looks like — composition, subject placement, background, lighting angle, color temperature, mood. Be specific enough that an artist could recreate this frame.",
      "dominantColors": ["#hex1", "#hex2", "#hex3"],
      "compositionType": "one of: wide-shot, medium-shot, close-up, extreme-close-up, overhead, low-angle, profile, over-shoulder, symmetrical, rule-of-thirds",
      "lightingMood": "specific lighting description for this frame",
      "recreationPrompt": "A complete, self-contained image generation prompt that would recreate a frame with this EXACT visual style but with GENERIC subject placeholders. Include all style details (rendering, colors, lighting, effects) hardcoded, with {SUBJECT} and {SCENE} as the only placeholders."
    }
  ],
  "masterTemplate": "A comprehensive, detailed image generation prompt with {PRIMARY_SUBJECT}, {PRIMARY_SUBJECT_ACTION}, {SECONDARY_SUBJECTS}, {ENVIRONMENT}, {MOOD}, and {SCENE_DESCRIPTION} placeholders. This template must be long enough and specific enough that filling in any topic produces an image visually indistinguishable from this style. Include explicit rendering technique, color specifications, lighting approach, background treatment, and special effects — all hardcoded. Only scene-specific content uses placeholders.",
  "sceneTemplates": {
    "portrait": "Single subject hero shot template — {PRIMARY_SUBJECT} and {MOOD} placeholders only",
    "group": "Multi-character scene template — {PRIMARY_SUBJECT}, {SECONDARY_SUBJECTS}, {MOOD} placeholders",
    "environment": "Establishing/location shot template — {ENVIRONMENT} placeholder, subject optional",
    "action": "Dynamic scene template — {PRIMARY_SUBJECT}, {PRIMARY_SUBJECT_ACTION}, {ENVIRONMENT}, {MOOD} placeholders",
    "object": "Object/vehicle focus template — {PRIMARY_SUBJECT}, {ENVIRONMENT} placeholders",
    "titleCard": "Text/title card frame template — {PRIMARY_SUBJECT}, {TEXT_OVERLAY} placeholders"
  }
}

The "keyframes" array MUST contain exactly 12 entries, spread evenly across the video duration. Each entry's "recreationPrompt" should be a standalone prompt that perfectly captures the visual style of that specific frame.`;

async function analyzeStyle(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header.' });

  const {
    youtubeUrl,
    frames,
    projectId,
    location = 'us-central1',
    model    = 'gemini-2.5-flash',
  } = req.body;

  if (!projectId) return res.status(400).json({ error: 'projectId is required.' });
  if (!youtubeUrl && (!frames || !frames.length)) {
    return res.status(400).json({ error: 'Either youtubeUrl or frames array is required.' });
  }

  const parts = [];

  if (youtubeUrl) {
    parts.push({ fileData: { mimeType: 'video/mp4', fileUri: youtubeUrl } });
  } else {
    const capped = frames.slice(0, 20);
    for (const frame of capped) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: frame } });
    }
  }

  parts.push({ text: ANALYSIS_PROMPT });

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: `Network error reaching Vertex AI: ${err.message}` });
  }

  let data;
  try { data = await upstream.json(); }
  catch { return res.status(500).json({ error: 'Failed to parse Vertex AI response.' }); }

  if (!upstream.ok || data.error) {
    const msg = data.error?.message || JSON.stringify(data.error || data);
    return res.status(upstream.status || 500).json({ error: msg });
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    const reason = data?.candidates?.[0]?.finishReason;
    return res.status(500).json({ error: reason ? `Generation stopped: ${reason}` : 'No content returned from model.' });
  }

  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let analysis;
  try {
    analysis = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { analysis = JSON.parse(match[0]); }
      catch { return res.status(500).json({ error: 'Failed to parse style analysis JSON.', raw: rawText.slice(0, 500) }); }
    } else {
      return res.status(500).json({ error: 'No valid JSON in model response.', raw: rawText.slice(0, 500) });
    }
  }

  return res.status(200).json(analysis);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  // Route POST ?action=analyze to the style analysis function
  const url    = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action');

  if (req.method === 'POST' && action === 'analyze') {
    return analyzeStyle(req, res);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header.' });

  const bucket = process.env.GOOGLE_GCS_BUCKET;
  if (!bucket)  return res.status(500).json({ error: 'GOOGLE_GCS_BUCKET env var not set.' });

  const gcsBase   = 'https://storage.googleapis.com/storage/v1';
  const gcsUpload = 'https://storage.googleapis.com/upload/storage/v1';
  const headers   = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

  // GET — list all styles
  if (req.method === 'GET') {
    const listUrl = `${gcsBase}/b/${bucket}/o?prefix=styles%2F&fields=items(name,timeCreated)`;
    const listRes = await fetch(listUrl, { headers });
    if (!listRes.ok) {
      const text = await listRes.text();
      return res.status(listRes.status).json({ error: text });
    }
    const listData = await listRes.json();
    const items    = (listData.items || []).filter(it => it.name.endsWith('.json'));

    if (items.length === 0) return res.status(200).json({ styles: [] });

    const fetchStyle = async (item) => {
      const encoded = encodeURIComponent(item.name);
      const r = await fetch(`${gcsBase}/b/${bucket}/o/${encoded}?alt=media`, { headers });
      if (!r.ok) return null;
      try { return await r.json(); } catch { return null; }
    };

    const results = await Promise.all(items.map(fetchStyle));
    const styles  = results.filter(Boolean);
    styles.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.status(200).json({ styles });
  }

  // POST — save a new style
  if (req.method === 'POST') {
    const style = req.body;
    if (!style || !style.styleName) {
      return res.status(400).json({ error: 'Request body must be a style object with a styleName.' });
    }

    const id         = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const objectName = `styles/${id}.json`;
    const payload    = { ...style, id, createdAt: new Date().toISOString() };

    const uploadUrl = `${gcsUpload}/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return res.status(uploadRes.status).json({ error: text });
    }

    return res.status(201).json({ id, objectName, style: payload });
  }

  // DELETE — remove a style
  if (req.method === 'DELETE') {
    const objectName = url.searchParams.get('id');
    if (!objectName) return res.status(400).json({ error: 'Query param ?id=<object_name> required.' });

    const encoded = encodeURIComponent(objectName);
    const delRes  = await fetch(`${gcsBase}/b/${bucket}/o/${encoded}`, { method: 'DELETE', headers });

    if (delRes.status === 404) return res.status(404).json({ error: 'Style not found.' });
    if (!delRes.ok) {
      const text = await delRes.text();
      return res.status(delRes.status).json({ error: text });
    }

    return res.status(200).json({ ok: true, deleted: objectName });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};
