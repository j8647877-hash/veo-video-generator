// POST /api/analyze-style
// Analyzes a video's visual style using Vertex AI Gemini (video understanding).
// Accepts either:
//   { youtubeUrl, projectId }           — YouTube URL passed directly to Gemini
//   { frames: [base64...], projectId }  — array of base64 JPEG frames from uploaded video
// Returns a structured style analysis JSON used to populate style templates.

const ANALYSIS_PROMPT = `You are an expert visual style analyst specializing in replicating video aesthetics for AI image generation.

Analyze the visual rendering style of this video carefully. Examine how things LOOK (artistic technique, color, lighting, rendering), NOT what the video is ABOUT. Strip out all topic, story, character names, and content.

Focus your analysis on these dimensions:
1. Rendering technique — 3D rendered, photorealistic, 2D illustrated, cel-shaded, mixed media, digital painting, etc.
2. Color palette — dominant colors with approximate hex values, warm/cool temperature, saturation level, contrast level
3. Color coding system — how colors are used to distinguish element types (e.g., "primary subjects use color A, backgrounds use color B")
4. Lighting style — rim lighting, volumetric, neon glow, soft ambient, hard shadows, subsurface scattering, light source direction
5. Background treatment — pure black void, gradient, detailed environment, minimal, relationship to foreground
6. Surface/floor treatment — reflective floor, textured ground, floating in void, reflection style
7. Figure/subject styling — proportions, level of stylization, skin texture detail, face detail, silhouette quality
8. Composition patterns — camera angles (eye-level, low-angle, aerial, isometric), framing, aspect ratio
9. Special effects — glow, particles, depth of field, film grain, bloom, chromatic aberration, vignette
10. Typography style — if text appears: font weight, color, effects (glow/shadow), placement
11. Signature elements — the 3-5 most distinctive visual quirks that make this style instantly recognizable

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
  "signatureElements": ["most distinctive element 1", "most distinctive element 2", "most distinctive element 3", "optional 4th", "optional 5th"],
  "aspectRatio": "16:9 or 9:16 or 4:3 or 1:1",
  "masterTemplate": "A comprehensive, detailed image generation prompt with {PRIMARY_SUBJECT}, {PRIMARY_SUBJECT_ACTION}, {SECONDARY_SUBJECTS}, {ENVIRONMENT}, {MOOD}, and {SCENE_DESCRIPTION} placeholders. This template must be long enough and specific enough that filling in any topic produces an image visually indistinguishable from this style. Include explicit rendering technique, color specifications, lighting approach, background treatment, and special effects — all hardcoded. Only scene-specific content uses placeholders.",
  "sceneTemplates": {
    "portrait": "Single subject hero shot template — {PRIMARY_SUBJECT} and {MOOD} placeholders only",
    "group": "Multi-character scene template — {PRIMARY_SUBJECT}, {SECONDARY_SUBJECTS}, {MOOD} placeholders",
    "environment": "Establishing/location shot template — {ENVIRONMENT} placeholder, subject optional",
    "action": "Dynamic scene template — {PRIMARY_SUBJECT}, {PRIMARY_SUBJECT_ACTION}, {ENVIRONMENT}, {MOOD} placeholders",
    "object": "Object/vehicle focus template — {PRIMARY_SUBJECT}, {ENVIRONMENT} placeholders",
    "titleCard": "Text/title card frame template — {PRIMARY_SUBJECT}, {TEXT_OVERLAY} placeholders"
  }
}`;

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
    youtubeUrl,
    frames,       // array of base64 JPEG strings
    projectId,
    location = 'us-central1',
    model    = 'gemini-2.0-flash-001',
  } = req.body;

  if (!projectId) return res.status(400).json({ error: 'projectId is required.' });
  if (!youtubeUrl && (!frames || !frames.length)) {
    return res.status(400).json({ error: 'Either youtubeUrl or frames array is required.' });
  }

  // Build the parts array for Gemini
  const parts = [];

  if (youtubeUrl) {
    // Pass YouTube URL directly — Gemini video understanding handles it
    parts.push({
      fileData: {
        mimeType: 'video/mp4',
        fileUri: youtubeUrl,
      },
    });
  } else {
    // Frames from uploaded video — send as inlineData images
    const capped = frames.slice(0, 20); // cap at 20 frames to stay within token limits
    for (const frame of capped) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: frame,
        },
      });
    }
  }

  parts.push({ text: ANALYSIS_PROMPT });

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
        },
      }),
    });
  } catch (err) {
    return res.status(500).json({ error: `Network error reaching Vertex AI: ${err.message}` });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return res.status(500).json({ error: 'Failed to parse Vertex AI response.' });
  }

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

  // Strip markdown code fences if model wrapped the JSON
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let analysis;
  try {
    analysis = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from the response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { analysis = JSON.parse(match[0]); }
      catch { return res.status(500).json({ error: 'Failed to parse style analysis JSON.', raw: rawText.slice(0, 500) }); }
    } else {
      return res.status(500).json({ error: 'No valid JSON in model response.', raw: rawText.slice(0, 500) });
    }
  }

  return res.status(200).json(analysis);
};
