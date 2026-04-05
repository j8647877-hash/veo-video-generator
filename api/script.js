// POST /api/script — Generates video scripts via Gemini using streaming SSE.
// Streams text chunks back as they arrive so the UI can render progressively.
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
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
  }

  const {
    prompt,
    systemPrompt  = '',
    scriptType    = 'YouTube Video',
    tone          = 'Conversational',
    audience      = 'General Public',
    length        = 'Medium (3–5 min)',
    format        = 'Single Narrator',
    language      = 'English',
    model         = 'gemini-2.5-pro-preview-06-05',
  } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required.' });
  }

  // Build the effective system instruction
  const defaultRole = `You are an expert ${scriptType} scriptwriter. You write compelling, well-structured scripts that engage the target audience from the first line.`;
  const systemInstruction = systemPrompt.trim() || defaultRole;

  // Build the user message with all control parameters woven in
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
- Use clear scene/section headings
- Use [STAGE DIRECTION] or (action notes) for visual cues
- Use SPEAKER NAME: for dialogue/narration labels
- Include a strong hook at the start and a clear call-to-action or closing
- Add timing estimates per section if relevant

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

  // Use streaming endpoint
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body:    requestBody,
    }
  );

  if (!upstream.ok) {
    const errData = await upstream.json().catch(() => ({}));
    const msg = errData.error?.message || `Upstream error ${upstream.status}`;
    return res.status(upstream.status || 500).json({ error: msg });
  }

  // Pipe SSE stream back to the client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Each SSE line looks like: data: {...json...}
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
          // Propagate finish reason
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
