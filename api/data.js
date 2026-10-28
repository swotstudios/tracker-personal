// Funzione Vercel: legge e salva i dati del tracker su Upstash Redis (via REST, senza dipendenze)
const { PASSWORD, authorized } = require('./_auth');

const KEY = 'tracker:data';
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const out = await r.json();
  if (!r.ok || out.error) throw new Error(out.error || `Redis ${r.status}`);
  return out.result;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!PASSWORD || !REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).send('Configurazione mancante: imposta TRACKER_PASSWORD e collega Upstash Redis al progetto.');
  }
  if (!authorized(req)) return res.status(401).send('Password errata');

  try {
    if (req.method === 'GET') {
      const value = await redis(['GET', KEY]);
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(value || 'null');
    }
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      JSON.parse(body); // rifiuta JSON non valido
      // Una copia di backup al giorno, tenuta per 60 giorni
      const day = new Date().toISOString().slice(0, 10);
      const prev = await redis(['GET', KEY]);
      if (prev) await redis(['SET', `${KEY}:backup:${day}`, prev, 'EX', 60 * 86400, 'NX']);
      await redis(['SET', KEY, body]);
      return res.status(204).end();
    }
    return res.status(405).end();
  } catch (e) {
    return res.status(500).send(String(e.message));
  }
};
