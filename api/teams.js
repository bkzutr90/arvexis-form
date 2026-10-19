const { allTeams, allEvents, activeEvent, counted, pubEvent } = require('./_lib');
// Publik: hanya nama tim yang sudah approved
module.exports = async (req, res) => {
  try {
    const [evs, act] = [await allEvents(), await activeEvent()];
    const ev = evs.find(e => e.id === (req.query || {}).event) || act;
    const teams = await allTeams(ev.id);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.json({
      events: evs.map(e => ({ id: e.id, name: e.name })), event: pubEvent(ev, counted(teams).length),
      teams: teams.filter(t => t.status === 'approved').reverse().map(t => t.team),
      pending: teams.filter(t => t.status === 'pending').length,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal memuat daftar tim.' }); }
};
