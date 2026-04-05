// GET /api/config — returns public app config (bucket name, project ID) for pre-filling the UI
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.json({
    bucket:    process.env.GOOGLE_GCS_BUCKET  || '',
    projectId: process.env.GOOGLE_PROJECT_ID  || '',
  });
};
