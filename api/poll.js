// GET /api/poll?operation=<operationName> — polls Vertex AI for operation status
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
    return res.status(204).end();
  }

  const authHeader = req.headers['authorization'];
  const operationName = req.query.operation;

  if (!authHeader || !operationName) {
    return res.status(400).json({ error: { message: 'Missing authorization or operation parameter' } });
  }

  // Operation name format:
  // projects/{project}/locations/{location}/publishers/google/models/{model}/operations/{id}
  const parts    = operationName.split('/');
  const project  = parts[1] || '';
  const location = parts[3] || 'us-central1';
  const model    = parts[7] || 'veo-3.1-lite-generate-001';

  const hostname   = `${location}-aiplatform.googleapis.com`;
  const vertexPath = `/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;

  const upstream = await fetch(`https://${hostname}${vertexPath}`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operationName }),
  });

  const data = await upstream.json();
  return res.status(upstream.status).json(data);
};
