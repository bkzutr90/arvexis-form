const { KEY, db, body, allTeams, activeEvent, evState, counted, limited, validateTeam } = require('./_lib');
const { notifyPending } = require('./_discord');
const CLOSED = { soon: 'Pendaftaran belum dibuka.', closed: 'Pendaftaran sedang ditutup.' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (await limited(req, 'reg', 10, 3600)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 1 jam.' });
    const b = body(req);
    if (b.website) return res.json({ ok: true }); // honeypot
    if (b.agree !== true) return res.status(400).json({ error: 'Konfirmasi bahwa semua pemain sudah join Discord Arvexis.' });

    const ev = await activeEvent();
    const teams = counted(await allTeams(ev.id));
    const st = evState(ev, teams.length);
    if (st !== 'open') return res.status(403).json({ error: st === 'full' ? `Slot penuh (${ev.max}/${ev.max} tim).` : CLOSED[st] });

    const v = await validateTeam(b, teams);
    const rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), eventId: ev.id,
      team: v.team, players: v.players, sub: v.sub, status: 'pending', createdAt: new Date().toISOString(),
    };
    await db(['HSET', KEY, rec.id, JSON.stringify(rec)]);

    // Notifikasi Discord (kegagalan tidak membatalkan pendaftaran)
    try {
      const ref = await notifyPending(rec);
      if (ref) { rec.msg = ref; await db(['HSET', KEY, rec.id, JSON.stringify(rec)]); }
    } catch (e) { console.error('Notif pending gagal', e); }
    res.json({ ok: true, team: rec.team });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Terjadi kesalahan server. Coba lagi sebentar.' });
  }
};
