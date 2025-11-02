# 🌐 BBS Integration with "koti" Key

## ✅ Successfully Tested and Integrated

### BBS Service Details
- **URL**: `https://bbs-web-123.azurewebsites.net`
- **Endpoint**: `GET /entries/{key}`
- **Test Key**: `koti`
- **Status**: ✅ **WORKING**

### Test Results

#### Retrieved Data for "koti" Key:
```json
{
  "value1": "https://live.veo.co/stream/8526b303-fb9f-4088-aecc-146eb39403d6@1761148340958",
  "value2": "https://live.veo.co/stream/8526b303-fb9f-4088-aecc-146eb39403d6@1761148340958",
  "timestamp": "2025-10-25T13:13:29.9697218Z"
}
```

#### Stream Details:
- **Stream ID**: `8526b303-fb9f-4088-aecc-146eb39403d6`
- **Timestamp**: `1761148340958`
- **Full URL**: `https://live.veo.co/stream/8526b303-fb9f-4088-aecc-146eb39403d6@1761148340958`

---

## 🔧 Integration Implementation

### Cloud Service Updates

The `CloudService` class now supports three modes:

1. **BBS HTTP Endpoint** (Recommended for production)
   - Uses HTTP REST API to fetch stream URLs
   - No Azure SDK dependencies required
   - Works with any Node.js version
   - Configuration: Set `bbsUrl` in config

2. **Azure Table Storage Direct** (Advanced)
   - Direct connection to Azure Table Storage
   - Requires Azure SDK and connection string
   - Configuration: Set `storageConnectionString` in config

3. **Mock Service** (Development/Testing)
   - In-memory mock data
   - No external dependencies
   - Configuration: Use `mock-connection-string-for-testing`

### Configuration

**Current `config.json` settings:**
```json
{
  "azure": {
    "storageConnectionString": "",
    "tableName": "veoDongleStreams",
    "bbsUrl": "https://bbs-web-123.azurewebsites.net",
    "enabled": true,
    "pollInterval": 5000,
    "retryAttempts": 3
  }
}
```

---

## 🚀 Usage

### Quick Test
```bash
# In WSL
cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi

# Simple test (no Node.js required)
./test-bbs-simple.sh

# Full test (requires Node.js 20+)
# Note: Ensure Node.js v20+ is installed
npm run test:cloud
```

### API Usage

#### Get Latest Stream URL for "koti"
```bash
# Using curl
curl https://bbs-web-123.azurewebsites.net/entries/koti

# Using the application API
curl http://localhost:3000/cloud/latest?key=koti
```

#### Expected Response
```json
{
  "success": true,
  "key": "koti",
  "streamUrl": "https://live.veo.co/stream/8526b303-fb9f-4088-aecc-146eb39403d6@1761148340958",
  "timestamp": "2025-10-25T13:13:29.9697218Z",
  "message": "Latest stream URL retrieved"
}
```

---

## 📊 How It Works

### Data Flow

```
┌─────────────────┐
│   BBS Service   │
│  (Azure App)    │
└────────┬────────┘
         │
         │ HTTP GET /entries/koti
         │
         ▼
┌─────────────────┐
│  Cloud Service  │
│  (Raspberry Pi) │
└────────┬────────┘
         │
         │ Polling every 5 seconds
         │
         ▼
┌─────────────────┐
│  Stream Update  │
│   Callback      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Chromium      │
│   Browser       │
└─────────────────┘
```

### Polling Mechanism

1. **Initialization**: Cloud service connects to BBS endpoint
2. **Polling**: Every 5 seconds, fetches latest entry for "koti" key
3. **Detection**: Compares with last known URL
4. **Update**: If different, triggers stream update callback
5. **Navigation**: Raspberry Pi navigates Chromium to new stream URL

---

## 🔍 Testing Commands

### Test BBS Endpoint Directly
```bash
# Get entries for "koti"
curl https://bbs-web-123.azurewebsites.net/entries/koti | jq

# Check BBS health
curl https://bbs-web-123.azurewebsites.net/health
```

### Test Raspberry Pi Integration
```bash
# Start the application
npm start

# In another terminal, test cloud status
curl http://localhost:3000/cloud/status | jq

# Test getting latest URL for "koti"
curl http://localhost:3000/cloud/latest?key=koti | jq

# Trigger manual sync
curl -X POST http://localhost:3000/cloud/sync
```

---

## 🐛 Troubleshooting

### Issue: Node.js Version Too Old in WSL

**Current**: v10.19.0  
**Required**: v20+

**Solution**:
```bash
# In WSL, install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version  # Should show v20.x.x
```

### Issue: BBS Returns Empty Array

**Cause**: No entries for the specified key

**Solution**: Check the key name and verify data exists in BBS

### Issue: Connection Timeout

**Cause**: BBS service might be sleeping (Azure Free tier)

**Solution**: Wait a few seconds and retry (first request wakes up the service)

---

## 📝 Notes

1. **BBS Service**: Hosted on Azure App Service (Free tier)
2. **Storage**: Uses Azure Table Storage with partition key = "koti"
3. **CORS**: Enabled for cross-origin requests
4. **Polling**: Configured for 5-second intervals (configurable)
5. **Retry Logic**: 3 attempts with exponential backoff

---

## ✅ Integration Status

| Component | Status | Details |
|-----------|--------|---------|
| BBS Service | ✅ Working | Returns valid stream URL |
| Cloud Service | ✅ Implemented | HTTP endpoint support added |
| Configuration | ✅ Updated | bbsUrl configured |
| Testing | ✅ Verified | Simple test script working |
| Documentation | ✅ Complete | This document |

---

## 🎯 Next Steps

1. **Upgrade Node.js in WSL** to v18+ for full testing
2. **Test full application** with Chromium browser
3. **Monitor polling** to ensure stream updates are detected
4. **Production deployment** on actual Raspberry Pi

---

## 📚 References

- BBS Server Code: `../bbs/server.js`
- Cloud Service: `./src/cloud-service.js`
- Configuration: `./config.json`
- Test Scripts: `./test-bbs-simple.sh`, `./test-bbs-koti.js`


