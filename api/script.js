// POST /api/script — Generates video scripts via Vertex AI Gemini with streaming SSE.
// Uses the user's Google OAuth token (same pattern as the image/video tools).
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
  const {
    prompt,
    projectId,
    location      = 'us-central1',
    systemPrompt  = '',
    scriptType    = 'YouTube Video',
    tone          = 'Conversational',
    audience      = 'General Public',
    length        = 'Medium (3–5 min)',
    format        = 'Single Narrator',
    language      = 'English',
    model         = 'gemini-2.5-flash',
  } = req.body;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header. Please sign in.' });
  }
  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required.' });
  }
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required.' });
  }

  // Build the effective system instruction
  const defaultRole = `You are an expert ${scriptType} scriptwriter. You write compelling, well-structured scripts that engage the target audience from the first line.`;
  const systemInstruction = systemPrompt.trim() || defaultRole;

  // Build the user message with all control parameters
  const userMessage = `Write a ${scriptType} script with the following specifications:

**Format:** ${format}
**Tone:** ${tone}
**Target audience:** ${audience}
**Approximate length:** ${length}
**Language:** ${language}

**Script brief:**
${prompt.trim()}

---

Format the script professionally:
- Use clear scene/section headings (e.g. ## INTRO, ## MAIN CONTENT, ## OUTRO)
- Use [STAGE DIRECTION] or (action notes) for visual cues
- Use SPEAKER NAME: for dialogue/narration labels where applicable
- Include a strong hook at the start and a clear call-to-action or closing
- Add timing estimates per section in parentheses where relevant

Write the complete, ready-to-use script now.`;

  const requestBody = JSON.stringify({
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.85,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  });

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:streamGenerateContent?alt=sse`;

  const upstream = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body:    requestBody,
  });

  if (!upstream.ok) {
    const errData = await upstream.json().catch(() => ({}));
    const msg = errData.error?.message || `Upstream error ${upstream.status}`;
    return res.status(upstream.status || 500).json({ error: msg });
  }

  // Stream SSE back to the client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader  = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
          const finishReason = parsed?.candidates?.[0]?.finishReason;
          if (finishReason && finishReason !== 'STOP') {
            res.write(`data: ${JSON.stringify({ warning: `Finish reason: ${finishReason}` })}\n\n`);
          }
        } catch {}
      }
    }
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
};
