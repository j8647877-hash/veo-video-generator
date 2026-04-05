// POST /api/image — generates images via Gemini Flash on Vertex AI
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
    location      = 'us-central1',
    model         = 'gemini-2.0-flash-exp',
    aspectRatio   = '1:1',
    style         = '',
    negativePrompt = '',
    count         = 1,
    referenceImageData = null,
    referenceImageMime = 'image/jpeg',
    referenceMode = 'style',   // 'style' | 'edit'
  } = req.body;

  if (!authHeader || !prompt || !projectId) {
    return res.status(400).json({ error: { message: 'Missing required fields: prompt, projectId' } });
  }

  // Compose the full prompt
  const stylePrefix = style && style !== 'none' ? `${style} style. ` : '';
  const negSuffix   = negativePrompt ? `. Avoid: ${negativePrompt}` : '';
  const refPrefix   = referenceImageData
    ? referenceMode === 'edit'
      ? 'Edit the provided image — '
      : 'Use the provided image as a visual style reference. Generate a new image: '
    : '';

  const fullPrompt = `${refPrefix}${stylePrefix}${prompt}. Aspect ratio: ${aspectRatio}${negSuffix}`;

  const parts = [{ text: fullPrompt }];
  if (referenceImageData) {
    parts.push({ inlineData: { mimeType: referenceImageMime, data: referenceImageData } });
  }

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  });

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const headers  = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

  const actualCount = Math.min(Math.max(1, Number(count)), 4);

  // Run requests in parallel
  const settled = await Promise.allSettled(
    Array.from({ length: actualCount }, () =>
      fetch(endpoint, { method: 'POST', headers, body: requestBody }).then(r => r.json())
    )
  );

  const images   = [];
  let lastError  = null;

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    if (data.error) { lastError = data.error; continue; }

    // Pull the image part out of the response
    const imagePart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart) {
      images.push({
        data:     imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType || 'image/png',
      });
    } else {
      // Some models return text explaining a refusal — surface it
      const textPart = data?.candidates?.[0]?.content?.parts?.find(p => p.text);
      if (textPart) lastError = { message: textPart.text };
    }
  }

  if (images.length === 0) {
    return res.status(400).json({
      error: lastError || { message: 'No images returned. The model may have refused the prompt.' },
    });
  }

  return res.status(200).json({ images });
};
