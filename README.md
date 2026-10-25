# Il mio tracker

Dashboard personale per allenamenti, peso, cibo e obiettivi. Zero dipendenze.

## Online (Vercel)

1. Importa la repository su Vercel (framework: Other, nessun build command). Il sito sta in `public/`, la funzione in `api/`.
2. Nel progetto Vercel → Storage → aggiungi **Upstash Redis** (piano free) e collegalo al progetto: crea da solo `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
3. Settings → Environment Variables → aggiungi `TRACKER_PASSWORD` con la password che vuoi usare.
4. Fai un Redeploy. L'app chiede la password al primo accesso e la ricorda su quel dispositivo.

I dati stanno su Redis nella chiave `tracker:data`, con una copia di backup al giorno tenuta per 60 giorni.

## In locale

```bash
npm start
```

Poi apri http://localhost:4321 (dal telefono, stessa Wi-Fi: l'indirizzo "Dal telefono" stampato nel terminale). In locale non serve password: i dati stanno in `data.json`, con un backup al giorno in `backups/`. Per usarlo solo sul Mac: `HOST=127.0.0.1 npm start`.

Per spostare i dati da locale a online: Dashboard → Impostazioni → Esporta backup, poi Importa backup sulla versione online.
