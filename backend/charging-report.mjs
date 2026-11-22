import '../exports.js';

const time = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short'
});
const day = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin', dateStyle: 'short'});

export async function chargingReport(company, sessions) {
  const actual = sessions.filter(session => !session.simulated);
  const rows = actual.map(session => ({
    start: time.format(new Date(session.started_at)),
    end: session.stopped_at ? time.format(new Date(session.stopped_at)) : '–',
    site: session.site_name || '–',
    point: session.point_name || 'Connector #' + session.connector_id,
    user: session.user_name || (session.authorization_kind === 'freecharge' ? 'Freecharge' : '–'),
    kwh: session.energy_wh == null ? null : Number(session.energy_wh) / 1000,
    rate: session.price_per_kwh == null ? null : Number(session.price_per_kwh),
    amount: session.amount_eur == null ? null : Number(session.amount_eur),
    status: session.stopped_at ? 'Beendet' : 'Aktiv'
  }));
  const dates = actual.map(session => day.format(new Date(session.started_at))).sort();
  const report = {live: true, company, from: dates[0], to: dates.at(-1), rows};
  return Buffer.from(await globalThis.ChargeVisorExports.pdfBlob(report).arrayBuffer());
}
