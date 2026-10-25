// Server locale senza dipendenze: serve l'app e salva i dati in data.json
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data.json');
const BACKUPS = path.join(ROOT, 'backups');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function readData() {
  try { return fs.readFileSync(DATA, 'utf8'); } catch { return 'null'; }
}

// Una copia di backup al giorno, così un errore non cancella lo storico
function backupDaily() {
  if (!fs.existsSync(DATA)) return;
  fs.mkdirSync(BACKUPS, { recursive: true });
  const file = path.join(BACKUPS, `data-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(file)) fs.copyFileSync(DATA, file);
}

function writeData(body) {
  JSON.parse(body); // rifiuta JSON non valido
  backupDaily();
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, DATA);
}

http.createServer((req, res) => {
  if (req.url === '/api/data') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(readData());
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 20e6) req.destroy(); });
      req.on('end', () => {
        try { writeData(body); res.writeHead(204); res.end(); }
        catch (e) { res.writeHead(400); res.end(String(e.message)); }
      });
      return;
    }
    res.writeHead(405); return res.end();
  }

  const urlPath = req.url.split('?')[0];
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT) || file.startsWith(DATA) || file.startsWith(BACKUPS)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`La porta ${PORT} è già in uso: probabilmente il tracker è già avviato, apri http://localhost:${PORT}`);
  console.log(`Per usarne un'altra: PORT=4322 npm start`);
  process.exit(1);
}).listen(PORT, HOST, () => {
  console.log(`Tracker attivo su http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`Dal telefono (stessa Wi-Fi): http://${n.address}:${PORT}`);
    }
  }
});
