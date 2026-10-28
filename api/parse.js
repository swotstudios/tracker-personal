// Funzione Vercel: trasforma la descrizione di un pasto ("yogurt 200 g, una banana…") in alimenti con kcal e macro stimati
const Anthropic = require('@anthropic-ai/sdk');
const { jsonSchemaOutputFormat } = require('@anthropic-ai/sdk/helpers/json-schema');
const { authorized } = require('./_auth');

const MODEL = 'claude-haiku-5-5';

const SYSTEM = `Sei un assistente nutrizionale. Ricevi la descrizione, scritta in italiano, di quello che una persona ha mangiato.
Scomponila nei singoli alimenti e stima per ognuno grammi, kcal, proteine, carboidrati e grassi.

- Usa valori nutrizionali medi di riferimento (come le tabelle CREA) per gli alimenti tipici italiani.
- Se la quantità è scritta, usala. Se manca, stima una porzione media (es. una banana ≈ 120 g, un uovo ≈ 60 g, un caffè ≈ 30 g) e imposta qty_stimata a true.
- I grammi di pasta, riso e cereali sono a crudo, salvo che la persona scriva "cotto/a".
- Un piatto composto (es. "pasta al tonno") va diviso nei suoi ingredienti principali, con condimenti realistici.
- Scrivi nome con l'iniziale maiuscola, al singolare quando ha senso (es. "Banana", "Yogurt bianco").
- Arrotonda: grammi e kcal a numeri interi, macro a una cifra decimale.
- Se il testo non descrive cibo, restituisci un elenco vuoto.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number', description: 'grammi (o ml per le bevande)' },
          qty_stimata: { type: 'boolean' },
          kcal: { type: 'number' },
          p: { type: 'number', description: 'proteine in g' },
          c: { type: 'number', description: 'carboidrati in g' },
          f: { type: 'number', description: 'grassi in g' },
        },
        required: ['name', 'qty', 'qty_stimata', 'kcal', 'p', 'c', 'f'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

let client;
async function parseMeal(text) {
  client ||= new Anthropic();
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: jsonSchemaOutputFormat(SCHEMA) },
    system: SYSTEM,
    messages: [{ role: 'user', content: text }],
  });
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('Richiesta rifiutata dal modello'), { status: 422 });
  if (!msg.parsed_output) throw new Error(msg.stop_reason === 'max_tokens' ? 'Descrizione troppo lunga' : 'Risposta non valida');
  return msg.parsed_output;
}

// Messaggio d'errore leggibile per l'app, partendo dalle eccezioni dell'SDK
function errorReply(e) {
  if (e instanceof Anthropic.AuthenticationError) return [502, 'Chiave API di Anthropic non valida'];
  if (e instanceof Anthropic.PermissionDeniedError) return [502, 'La chiave API non ha i permessi necessari'];
  if (e instanceof Anthropic.RateLimitError) return [429, 'Troppe richieste o credito esaurito: riprova tra poco'];
  if (e instanceof Anthropic.APIError && e.status === 400 && /credit|billing/i.test(e.message)) return [402, 'Credito Anthropic esaurito'];
  if (e instanceof Anthropic.APIConnectionError) return [502, 'Impossibile contattare Anthropic'];
  return [e.status || 500, e.message || 'Errore'];
}

async function handle(body) {
  if (!process.env.ANTHROPIC_API_KEY) return [500, 'Chiave API non configurata: aggiungi ANTHROPIC_API_KEY'];
  const text = String(body?.text || '').trim();
  if (!text) return [400, 'Scrivi cosa hai mangiato'];
  if (text.length > 600) return [400, 'Descrizione troppo lunga (max 600 caratteri)'];
  try { return [200, await parseMeal(text)]; } catch (e) { return errorReply(e); }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorized(req)) return res.status(401).send('Password errata');
  if (req.method !== 'POST') return res.status(405).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const [status, out] = await handle(body);
  return status === 200 ? res.status(200).json(out) : res.status(status).send(out);
};
module.exports.handle = handle;
