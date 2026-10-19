const KEY = 'arvexis:teams';
async function db(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Database belum terhubung (Upstash Redis).');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function allTeams() {
  const rows = await db(['HVALS', KEY]);
  return (rows || []).map(r => JSON.parse(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
const body = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
module.exports = { KEY, db, allTeams, body };
