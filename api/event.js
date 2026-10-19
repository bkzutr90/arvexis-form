const { allTeams, activeEvent, counted, pubEvent } = require('./_lib');
module.exports = async (req, res) => {
  try {
    const ev = await activeEvent();
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    res.json(pubEvent(ev, counted(await allTeams(ev.id)).length));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal memuat event.' }); }
};
