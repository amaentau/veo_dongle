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

## IoT Hub Integration

The BBS service now supports Azure IoT Hub for cloud-to-device commands. This enables near real-time control of registered devices.

## Security Features

### Device Authentication
- **Secure Tokens**: Devices use JWT tokens instead of predictable device IDs
- **SAS Tokens**: IoT Hub access uses temporary SAS tokens (24-hour expiry)
- **Rate Limiting**: 5 commands per minute per user per device
- **Token Validation**: All device requests validated against stored tokens

### IoT Hub Security
- **No Connection String Exposure**: Full connection strings never sent to devices
- **Time-Limited Access**: SAS tokens expire automatically
- **Scoped Permissions**: Devices only get necessary IoT Hub permissions

### Device Registration

To register a device with IoT Hub (Master users only):

```bash
# Register device with IoT Hub
curl -X POST https://your-bbs-url/devices/{deviceId}/register-iot \
  -H "Authorization: Bearer {jwt-token}" \
  -H "Content-Type: application/json"

# Response:
{
  "ok": true,
  "deviceId": "rpi-device-123",
  "iotHubStatus": "enabled",
  "registered": true
}
```

### Device Status

Check IoT Hub registration status:

```bash
curl -X GET https://your-bbs-url/devices/{deviceId}/iot-status \
  -H "Authorization: Bearer {jwt-token}"

# Response:
{
  "deviceId": "rpi-device-123",
  "iotHubStatus": "enabled",
  "connectionState": "Disconnected",
  "lastActivityTime": null
}
```

### Configuration

Add these environment variables to your BBS deployment:

```bash
# Required for IoT Hub management
IOT_HUB_SUBSCRIPTION_ID=your-azure-subscription-id
IOT_HUB_RESOURCE_GROUP=EspaTvResourceGroup  # Your resource group
IOT_HUB_NAME=espa-tv-iot-hub       # Your IoT Hub name
```

The service uses Azure Default Credential authentication, so ensure your deployment has appropriate Azure RBAC permissions for IoT Hub management.

## Testing Commands

### Device Registration & Authentication
```bash
# 1. Register device with IoT Hub (generates secure tokens)
curl -X POST https://espa-tv-app.azurewebsites.net/devices/rpi-device/register-iot \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 2. Device gets authentication token (automatic)
curl -X GET https://espa-tv-app.azurewebsites.net/devices/rpi-device/auth-token

# 3. Device gets SAS token for IoT Hub access
curl -X GET "https://espa-tv-app.azurewebsites.net/devices/rpi-device/iot-connection?token=DEVICE_TOKEN"
```

### Sending Commands
**Via HTTP API (existing):**
```bash
curl -X POST http://raspberry-pi:3000/control/play
```

**Via IoT Hub (new secure method):**
```bash
# Send command via BBS (rate limited: 5/minute)
curl -X POST https://espa-tv-app.azurewebsites.net/devices/rpi-device/commands/play \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Send command with payload
curl -X POST https://espa-tv-app.azurewebsites.net/devices/rpi-device/commands/change-track \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trackId": "song-123"}'
```

### Checking Device Status
```bash
# Get IoT Hub registration status
curl -X GET https://espa-tv-app.azurewebsites.net/devices/rpi-device/iot-status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Files:
- `server.js` — Express + Table Storage
- `public/` — frontend assets
- `deploy-azure.sh` — CLI deploy script (WSL-friendly)
- `package.json` — deps and start script


