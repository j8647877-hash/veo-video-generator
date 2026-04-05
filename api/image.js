// POST /api/image — generates images via Vertex AI (Imagen or Gemini Flash)
// Automatically selects the right endpoint based on the model name.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const authHeader = req.headers['authorization'];
  const {
    prompt,
    projectId,
    location          = 'us-central1',
    model             = 'imagen-3.0-generate-001',
    aspectRatio       = '1:1',
    style             = '',
    negativePrompt    = '',
    count             = 1,
    referenceImageData = null,
    referenceImageMime = 'image/jpeg',
    referenceMode     = 'style',
  } = req.body;

  if (!authHeader || !prompt || !projectId) {
    return res.status(400).json({ error: { message: 'Missing required fields: prompt, projectId' } });
  }

  const actualCount = Math.min(Math.max(1, Number(count)), 4);
  const stylePrefix = style && style !== 'none' ? `${style} style. ` : '';
  const fullPrompt  = `${stylePrefix}${prompt}`;
  const headers     = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

  const isImagen = model.startsWith('imagen');

  // ── Imagen models ────────────────────────────────────────────────────────────
  if (isImagen) {
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

    const body = JSON.stringify({
      instances: [{ prompt: fullPrompt }],
      parameters: {
        sampleCount:    actualCount,
        aspectRatio,
        ...(negativePrompt ? { negativePrompt } : {}),
        ...(referenceImageData ? {
          referenceImages: [{
            referenceType: referenceMode === 'edit' ? 'REFERENCE_TYPE_SUBJECT' : 'REFERENCE_TYPE_STYLE',
            referenceImage: { bytesBase64Encoded: referenceImageData },
          }],
        } : {}),
      },
    });

    const upstream = await fetch(endpoint, { method: 'POST', headers, body });
    const data     = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json(data);
    }

    const images = (data.predictions || []).map(p => ({
      data:     p.bytesBase64Encoded,
      mimeType: p.mimeType || 'image/png',
    }));

    if (images.length === 0) {
      return res.status(400).json({ error: { message: 'No images returned from Imagen. The prompt may have been filtered.' } });
    }

    return res.status(200).json({ images });
  }

  // ── Gemini models (generateContent) ─────────────────────────────────────────
  const refPrefix = referenceImageData
    ? referenceMode === 'edit'
      ? 'Edit the provided image — '
      : 'Use the provided image as a visual style reference. Generate: '
    : '';
  const negSuffix   = negativePrompt ? `. Avoid: ${negativePrompt}` : '';
  const geminiPrompt = `${refPrefix}${fullPrompt}. Aspect ratio: ${aspectRatio}${negSuffix}`;

  const parts = [{ text: geminiPrompt }];
  if (referenceImageData) {
    parts.push({ inlineData: { mimeType: referenceImageMime, data: referenceImageData } });
  }

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'] },
  });

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const settled = await Promise.allSettled(
    Array.from({ length: actualCount }, () =>
      fetch(endpoint, { method: 'POST', headers, body: requestBody }).then(r => r.json())
    )
  );

  const images  = [];
  let lastError = null;

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    if (data.error) { lastError = data.error; continue; }
    const imagePart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart) {
      images.push({ data: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType || 'image/png' });
    } else {
      const textPart = data?.candidates?.[0]?.content?.parts?.find(p => p.text);
      if (textPart) lastError = { message: textPart.text };
    }
  }

  if (images.length === 0) {
    return res.status(400).json({ error: lastError || { message: 'No images returned.' } });
  }

  return res.status(200).json({ images });
};
