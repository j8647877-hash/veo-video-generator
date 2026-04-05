// POST /api/tts — Converts text to speech via Gemini 2.5 TTS.
// Returns a WAV audio file (raw PCM + WAV header) directly in the response body.
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
    text,
    stylePrompt   = '',
    voice         = 'Aoede',
    voice2        = 'Puck',
    speaker1Name  = 'Speaker1',
    speaker2Name  = 'Speaker2',
    mode          = 'single',   // 'single' | 'multi'
    model         = 'gemini-2.5-flash-preview-tts',
  } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required.' });
  }

  // Combine style direction with the script
  const fullPrompt = stylePrompt.trim()
    ? `${stylePrompt.trim()}\n\n${text.trim()}`
    : text.trim();

  // Build speechConfig based on single vs. multi-speaker
  const speechConfig = mode === 'multi'
    ? {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: speaker1Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: voice  } } },
            { speaker: speaker2Name, voiceConfig: { prebuiltVoiceConfig: { voiceName: voice2 } } },
          ],
        },
      }
    : {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      };

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig,
    },
  });

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body:    requestBody,
    }
  );

  const data = await upstream.json();

  if (!upstream.ok || data.error) {
    const msg = data.error?.message || JSON.stringify(data.error || data);
    return res.status(upstream.status || 400).json({ error: msg });
  }

  const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) {
    return res.status(400).json({ error: 'No audio data returned. The API may have filtered your content.', raw: data });
  }

  const pcm = Buffer.from(b64, 'base64');
  const wav = addWavHeader(pcm, 24000, 1, 16);

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', wav.length);
  res.setHeader('Content-Disposition', 'inline; filename="voiceover.wav"');
  res.send(wav);
};

// Prepend a standard 44-byte WAV header to raw 16-bit PCM data.
function addWavHeader(pcmBuffer, sampleRate, numChannels, bitsPerSample) {
  const byteRate   = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize   = pcmBuffer.length;
  const header     = Buffer.alloc(44);

  header.write('RIFF',                 0);
  header.writeUInt32LE(36 + dataSize,  4);  // ChunkSize
  header.write('WAVE',                 8);
  header.write('fmt ',                12);
  header.writeUInt32LE(16,            16);  // Subchunk1Size (PCM)
  header.writeUInt16LE(1,             20);  // AudioFormat   (1 = PCM)
  header.writeUInt16LE(numChannels,   22);
  header.writeUInt32LE(sampleRate,    24);
  header.writeUInt32LE(byteRate,      28);
  header.writeUInt16LE(blockAlign,    32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data',                36);
  header.writeUInt32LE(dataSize,      40);

  return Buffer.concat([header, pcmBuffer]);
}
