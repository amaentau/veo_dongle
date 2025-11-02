Minimal BBS on Azure (Free Tier)

Endpoints:
- POST `/entry` — body: `{ key, value1, value2 }`
- GET `/entries/{key}` — returns latest 10

Storage: Azure Table Storage. Backend: Node.js (Express). Hosting: Azure App Service Free (F1). Frontend served from `/`.

Local run (WSL) — requires Node 22:
```bash
cd bbs
npm install
export STORAGE_CONNECTION_STRING="<your conn string>"
export TABLE_NAME="bbsEntries"
npm start
# open http://localhost:3000
```

Deploy to Azure (Free):
```bash
# args: <resource-group> <region> <storage-name> <app-name>
./deploy-azure.sh bbs-rg eastus bbsstor1234 bbs-web-1234
# then open https://bbs-web-1234.azurewebsites.net
```

API:
- POST `/entry`
  - body: `{ "key": string, "value1": string, "value2": string }`
  - returns: `{ ok: true, timestamp: string }`
- GET `/entries/{key}`
  - returns: `[{ value1, value2, timestamp }, ...]` (up to 10)

Notes:
- UTC timestamps created server-side.
- CORS enabled.
- Whitelist placeholder in `server.js` (`isKeyAllowed`).

Files:
- `server.js` — Express + Table Storage
- `public/` — frontend assets
- `deploy-azure.sh` — CLI deploy script (WSL-friendly)
- `package.json` — deps and start script


