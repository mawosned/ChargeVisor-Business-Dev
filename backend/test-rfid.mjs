const validTag = value => typeof value === 'string' && /^SIM-[A-Z0-9_-]{1,16}$/.test(value);
export const validUuid = value => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const validIdentity = value => typeof value === 'string' && /^[-\w.:]{2,120}$/.test(value);

const assignedPoint = `
  SELECT 1
  FROM cv_users u
  JOIN cv_point_access a ON a.user_id=u.id AND a.tenant_id=u.tenant_id
  JOIN cv_chargepoints p ON p.id=a.chargepoint_id AND p.tenant_id=a.tenant_id
  WHERE u.id=`;
const enabledStationPoint = `
  AND u.tenant_id=$2 AND u.enabled AND u.role='user'
  AND p.station_id=$3 AND p.ocpp_identity=$1 AND p.enabled`;
const virtualCredential = `
  SELECT 1
  FROM cv_ocpp_credentials c
  JOIN cv_stations s ON s.id=c.station_id AND s.tenant_id=c.tenant_id
  JOIN cv_tenants t ON t.id=c.tenant_id
  WHERE c.identity=$1 AND c.tenant_id=$2 AND c.station_id=$3
    AND s.is_simulator AND t.status='active' AND t.deleted_at IS NULL`;

export async function ensureTestRfidSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cv_test_rfid_windows (
      identity text PRIMARY KEY REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,
      opened_by uuid NOT NULL REFERENCES cv_users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      candidate text
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cv_test_rfid_cards (
      identity text NOT NULL REFERENCES cv_ocpp_credentials(identity) ON DELETE CASCADE,
      id_tag text NOT NULL,
      user_id uuid NOT NULL REFERENCES cv_users(id) ON DELETE CASCADE,
      PRIMARY KEY (identity,id_tag)
    )`);
}

export async function allowsTestRfid(pool, ctx, tag, connectorId = null) {
  if (!ctx.simulated || !validTag(tag)) return false;
  const result = await pool.query(`
    SELECT 1 FROM cv_test_rfid_cards card
    WHERE card.identity=$1 AND card.id_tag=$4
      AND EXISTS (${virtualCredential})
      AND EXISTS (${assignedPoint}card.user_id ${enabledStationPoint}
        AND ($5::integer IS NULL OR p.connector_number=$5))`,
  [ctx.identity, ctx.tenantId, ctx.stationId, tag, connectorId]);
  return result.rowCount > 0;
}

export async function captureTestRfid(pool, ctx, tag) {
  if (!ctx.simulated || !validTag(tag)) return;
  await pool.query(`
    UPDATE cv_test_rfid_windows w SET candidate=$4
    WHERE w.identity=$1 AND w.expires_at>now() AND w.candidate IS NULL
      AND EXISTS (${virtualCredential})
      AND NOT EXISTS (SELECT 1 FROM cv_test_rfid_cards card WHERE card.identity=w.identity AND card.id_tag=$4)`,
  [ctx.identity, ctx.tenantId, ctx.stationId, tag]);
}

async function readAction(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4000) return {status:413,error:'Anfrage zu groß'};
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return {data};
  } catch {}
  return {status:400,error:'Ungültige Anfrage'};
}

async function readEnrollment(pool, identity, actorId) {
  const pending = await pool.query(`
    SELECT expires_at AS "expiresAt",candidate FROM cv_test_rfid_windows
    WHERE identity=$1 AND opened_by=$2 AND expires_at>now()`, [identity, actorId]);
  const cards = await pool.query(`
    SELECT id_tag AS "idTag",user_id AS "userId" FROM cv_test_rfid_cards
    WHERE identity=$1 ORDER BY id_tag`, [identity]);
  return {window:pending.rows[0] ?? null,cards:cards.rows};
}

async function confirmCard(pool, scope, actor, candidate, userId) {
  // Keep the captured UID available for a retry when the selected user is ineligible.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const captured = await client.query(`
      DELETE FROM cv_test_rfid_windows
      WHERE identity=$1 AND opened_by=$4 AND candidate=$5 AND expires_at>now()
        AND EXISTS (${virtualCredential})
      RETURNING identity`, [...scope, actor.id, candidate]);
    const enrolled = captured.rowCount ? await client.query(`
      INSERT INTO cv_test_rfid_cards(identity,id_tag,user_id)
      SELECT $1,$4,$5 WHERE EXISTS (${assignedPoint}$5 ${enabledStationPoint})
      ON CONFLICT DO NOTHING RETURNING identity`, [...scope, candidate, userId]) : null;
    if (!enrolled?.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(`
      INSERT INTO cv_audit(actor_id,tenant_id,action,target_id)
      VALUES ($1,$2,'test_rfid_enrolled',$3)`, [actor.id, scope[1], scope[0]]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function handleTestRfid({pool, actor, req, params, origin, send}) {
  if (actor.role !== 'superadmin') return send(403,{error:'Nur Walectra darf Testkarten anlernen'});
  if (req.method !== 'GET' && req.method !== 'POST') return send(405,{error:'Methode nicht verfügbar'});

  let request = Object.fromEntries(params);
  if (req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!origin || req.headers.origin !== origin || contentType !== 'application/json') {
      return send(403,{error:'Ungültige Anfrage'});
    }
    const body = await readAction(req);
    if (!body.data) return send(body.status,{error:body.error});
    request = body.data;
  }

  const {identity, tenantId, stationId, action, candidate, userId} = request;
  if (!validIdentity(identity) || !validUuid(tenantId) || !validUuid(stationId)) {
    return send(400,{error:'Kunde, Teststation und OCPP-ID sind erforderlich'});
  }
  const scope = [identity,tenantId,stationId];
  const station = await pool.query(virtualCredential, scope);
  if (!station.rowCount) return send(404,{error:'Aktive virtuelle Teststation nicht gefunden'});

  if (req.method === 'POST') {
    switch (action) {
      case 'open': {
        const opened = await pool.query(`
          INSERT INTO cv_test_rfid_windows(identity,opened_by,expires_at)
          VALUES ($1,$2,now()+interval '90 seconds')
          ON CONFLICT (identity) DO UPDATE
          SET opened_by=EXCLUDED.opened_by,expires_at=EXCLUDED.expires_at,candidate=NULL
          WHERE cv_test_rfid_windows.expires_at<=now()
          RETURNING identity`, [identity,actor.id]);
        if (!opened.rowCount) return send(409,{error:'Für diese OCPP-ID läuft bereits ein Einlesefenster'});
        break;
      }
      case 'cancel':
        await pool.query('DELETE FROM cv_test_rfid_windows WHERE identity=$1 AND opened_by=$2',[identity,actor.id]);
        break;
      case 'confirm': {
        if (!validTag(candidate) || !validUuid(userId)) return send(400,{error:'Testkarte und Nutzer auswählen'});
        if (!await confirmCard(pool,scope,actor,candidate,userId)) {
          return send(409,{error:'Einlesefenster prüfen und einen aktiven Nutzer mit Freigabe für diese Teststation wählen'});
        }
        break;
      }
      default:
        return send(400,{error:'Unbekannte Aktion'});
    }
  }

  return send(200,await readEnrollment(pool,identity,actor.id));
}
