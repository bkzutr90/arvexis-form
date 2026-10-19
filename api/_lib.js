const KEY = 'arvexis:teams', EKEY = 'arvexis:events', AKEY = 'arvexis:active';
async function db(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Database belum terhubung (Upstash Redis).');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const body = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});
const err = (status, message) => Object.assign(new Error(message), { status });

// ---------- Event ----------
const DEFAULT_EVENT = { id: 'fm1', name: 'Fun Match #1', open: true, max: 16, opensAt: '', closesAt: '', prize: '', schedule: [], rulesUrl: '' };
const evOf = t => t.eventId || 'fm1'; // data lama tanpa eventId dianggap milik fm1
async function allTeams(eventId) {
  const rows = await db(['HVALS', KEY]);
  const l = (rows || []).map(r => JSON.parse(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return eventId ? l.filter(t => evOf(t) === eventId) : l;
}
async function allEvents() {
  const rows = await db(['HVALS', EKEY]);
  const l = (rows || []).map(r => JSON.parse(r)).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!l.length) return [{ ...DEFAULT_EVENT }];
  if (!l.some(e => e.id === 'fm1')) l.push({ ...DEFAULT_EVENT, open: false });
  return l;
}
async function activeEvent() {
  const [evs, id] = [await allEvents(), await db(['GET', AKEY])];
  return evs.find(e => e.id === id) || evs[0];
}
const counted = teams => teams.filter(t => t.status !== 'rejected');
function evState(ev, count) {
  const n = Date.now();
  if (!ev.open) return 'closed';
  if (ev.opensAt && n < Date.parse(ev.opensAt)) return 'soon';
  if (ev.closesAt && n > Date.parse(ev.closesAt)) return 'closed';
  if (count >= ev.max) return 'full';
  return 'open';
}
const pubEvent = (ev, count) => ({ id: ev.id, name: ev.name, state: evState(ev, count), max: ev.max, count, opensAt: ev.opensAt, closesAt: ev.closesAt, prize: ev.prize, schedule: ev.schedule || [], rulesUrl: ev.rulesUrl });

// ---------- Rate limit (per IP) ----------
const ipOf = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
async function limited(req, name, max, sec) {
  const k = `arvexis:rl:${name}:${ipOf(req)}`;
  await db(['SET', k, 0, 'EX', sec, 'NX']);
  return (await db(['INCR', k])) > max;
}

// ---------- Validasi tim ----------
const clean = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const norm = s => String(s).toLowerCase();
const normDiscord = s => norm(String(s).trim()).replace(/^@/, '').replace(/#\d+$/, '');
const ROLES = ['Killer', 'Survivor', 'Killer + Survivor'];

// null = API Roblox tidak bisa dihubungi (validasi dilewati agar pendaftaran tidak macet)
async function robloxLookup(names) {
  try {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: names, excludeBannedUsers: false }), signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return new Map((j.data || []).map(u => [norm(u.requestedUsername), u]));
  } catch { return null; }
}

// existing = tim lain di event yang sama (bukan rejected). Duplikat hanya dicek di dalam event yang sama.
async function validateTeam(b, existing) {
  const team = clean(b.team);
  if (team.length < 2) throw err(400, 'Nama tim wajib diisi.');
  const players = (b.players || []).slice(0, 5).map(p => ({ discord: clean(p.discord), roblox: clean(p.roblox), role: clean(p.role) }));
  if (players.length < 5 || players.some(p => !p.discord || !p.roblox || !p.role)) throw err(400, 'Data 5 pemain utama harus diisi lengkap.');
  const s = b.sub || {};
  const sub = { discord: clean(s.discord), roblox: clean(s.roblox), role: clean(s.role) };
  const filled = Object.values(sub).filter(Boolean).length;
  if (filled > 0 && filled < 3) throw err(400, 'Data cadangan harus diisi lengkap atau dikosongkan.');
  const hasSub = filled === 3;
  if (players.some(p => !ROLES.includes(p.role)) || (hasSub && !ROLES.includes(sub.role))) throw err(400, 'Role tidak valid.');

  const list = hasSub ? [...players, sub] : players;
  if (new Set(list.map(p => norm(p.roblox))).size !== list.length) throw err(400, 'Ada username Roblox yang dobel di dalam tim.');
  if (new Set(list.map(p => normDiscord(p.discord))).size !== list.length) throw err(400, 'Ada username Discord yang dobel di dalam tim.');

  const found = await robloxLookup(list.map(p => p.roblox));
  if (found) {
    const nf = list.filter(p => !found.has(norm(p.roblox)));
    if (nf.length) throw err(400, `Username Roblox tidak ditemukan: ${nf.map(p => p.roblox).join(', ')}. Pakai username, bukan display name.`);
    list.forEach(p => { const u = found.get(norm(p.roblox)); p.roblox = u.name; p.rid = u.id; });
  }

  if (existing.some(t => norm(t.team) === norm(team))) throw err(409, 'Nama tim sudah terdaftar di event ini. Pakai nama lain.');
  const all = t => [...t.players, ...(t.sub ? [t.sub] : [])];
  const ur = new Set(existing.flatMap(t => all(t).map(p => norm(p.roblox))));
  const ud = new Set(existing.flatMap(t => all(t).map(p => normDiscord(p.discord))));
  const dr = list.find(p => ur.has(norm(p.roblox)));
  if (dr) throw err(409, `Username Roblox "${dr.roblox}" sudah terdaftar di tim lain pada event ini.`);
  const dd = list.find(p => ud.has(normDiscord(p.discord)));
  if (dd) throw err(409, `Username Discord "${dd.discord}" sudah terdaftar di tim lain pada event ini.`);
  return { team, players, sub: hasSub ? sub : null };
}

module.exports = { KEY, EKEY, AKEY, db, body, err, allTeams, allEvents, activeEvent, evOf, evState, counted, pubEvent, limited, validateTeam, normDiscord };
