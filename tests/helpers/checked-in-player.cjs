'use strict';

// Game fixtures create registered participants and then explicitly check them in.
// Return the checked-in profile, including its new CAS version, to every caller.
async function createCheckedInPlayer(api, body, method = 'POST') {
  const created = await api('players', body, method);
  const checkedIn = await api('players/attendance', {
    id: created.player.id,
    version: created.player.version,
    attendance: 'present',
  });
  return { ...created, player: checkedIn.player };
}

module.exports = { createCheckedInPlayer };
