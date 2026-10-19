const { KEY, db, allTeams, body } = require('./_lib');
const clean = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 60);
const norm = s => s.toLowerCase();
const ROLES = ['Killer', 'Survivor', 'Killer + Survivor'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const b = body(req);
    if (b.website) return res.json({ ok: true }); // honeypot
    if (b.agree !== true) return res.status(400).json({ error: 'Konfirmasi bahwa semua pemain sudah join Discord Arvexis.' });
    const team = clean(b.team);
    if (team.length < 2) return res.status(400).json({ error: 'Nama tim wajib diisi.' });

    const players = (b.players || []).slice(0, 5).map(p => ({ discord: clean(p.discord), roblox: clean(p.roblox), role: clean(p.role) }));
    if (players.length < 5 || players.some(p => !p.discord || !p.roblox || !p.role))
      return res.status(400).json({ error: 'Data 5 pemain utama harus diisi lengkap.' });

    const s = b.sub || {};
    const sub = { discord: clean(s.discord), roblox: clean(s.roblox), role: clean(s.role) };
    const filled = Object.values(sub).filter(Boolean).length;
    if (filled > 0 && filled < 3) return res.status(400).json({ error: 'Data cadangan harus diisi lengkap atau dikosongkan.' });
    const hasSub = filled === 3;
    if (players.some(p => !ROLES.includes(p.role)) || (hasSub && !ROLES.includes(sub.role)))
      return res.status(400).json({ error: 'Role tidak valid.' });

    const list = hasSub ? [...players, sub] : players;
    const robloxNames = list.map(p => norm(p.roblox));
    if (new Set(robloxNames).size !== robloxNames.length)
      return res.status(400).json({ error: 'Ada username Roblox yang dobel di dalam tim.' });

    const existing = await allTeams();
    if (existing.some(t => norm(t.team) === norm(team)))
      return res.status(409).json({ error: 'Nama tim sudah terdaftar. Pakai nama lain.' });
    const used = new Set(existing.flatMap(t => [...t.players, ...(t.sub ? [t.sub] : [])].map(p => norm(p.roblox))));
    const dupe = robloxNames.find(n => used.has(n));
    if (dupe) return res.status(409).json({ error: `Username Roblox "${dupe}" sudah terdaftar di tim lain.` });

    const rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      team, players, sub: hasSub ? sub : null, status: 'pending', createdAt: new Date().toISOString(),
    };
    await db(['HSET', KEY, rec.id, JSON.stringify(rec)]);

    // Notifikasi Discord (kegagalan webhook tidak membatalkan pendaftaran)
    if (process.env.DISCORD_WEBHOOK_URL) {
      const line = (p, i) => `**${i}.** ${p.discord} • ${p.roblox} • ${p.role}`;
      const embed = {
        title: '📥 Pendaftaran Baru: ' + team,
        color: 0xc0121f,
        description: players.map((p, i) => line(p, i + 1)).join('\n'),
        fields: [...(hasSub ? [{ name: 'Cadangan', value: line(sub, '⤷') }] : []), { name: 'Cek sebelum approve', value: 'Pastikan semua pemain sudah join server Discord Arvexis.' }],
        footer: { text: 'Arvexis Community • Violence District Tournament' },
        timestamp: rec.createdAt,
      };
      try {
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'Arvexis Registration', embeds: [embed] }),
        });
      } catch (e) { console.error('Discord webhook gagal', e); }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Terjadi kesalahan server. Coba lagi sebentar.' });
  }
};
