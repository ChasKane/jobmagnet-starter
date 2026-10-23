/** Ingest hunt stays off the Apply surface unless the user must sign in. */
const HUNT_TAB_ID = '__hunt__';

function isHuntTab(id) {
  return String(id || '') === HUNT_TAB_ID;
}

function huntShowsApply(reason) {
  return reason === 'login';
}

module.exports = { HUNT_TAB_ID, isHuntTab, huntShowsApply };
