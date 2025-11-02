# Veo Dongle Raspberry Pi Component

This component provides a Raspberry Pi-based solution for controlling Chromium browser to display Veo streams programmatically using Puppeteer.

## Features

- 🚀 **Automated Stream Control**: Automatically launches Chromium and navigates to Veo streams
- 🎮 **Remote Control**: HTTP API and WebSocket interface for remote control
- 🔐 **Authentication Support**: Automatic login to Veo platform when required
- 🌐 **Cloud Integration**: Azure Table Storage for reliable cloud interaction (BBS pattern)
- 🌐 **Legacy Support**: Backward compatible with Socket.IO cloud services
- 🖥️ **Fullscreen Kiosk Mode**: Runs in fullscreen kiosk mode for dedicated display
- 🔄 **Auto-retry Logic**: Robust error handling with automatic recovery
- 📱 **Multi-platform**: Works on Raspberry Pi, WSL, and other Linux systems

## Prerequisites

### For Raspberry Pi
- Raspberry Pi 3 or later (4GB+ RAM recommended)
- Raspberry Pi OS (64-bit recommended)
- Node.js 20 or later
- Chromium browser

### For WSL Development
- Windows 10/11 with WSL2
- Ubuntu 20.04 or later in WSL
- Node.js 20 or later
- Chromium browser in WSL

## Quick Start

### 1. Clone and Setup

```bash
# Navigate to raspberry-pi directory
cd raspberry-pi

# Run automatic setup (detects environment)
./setup.sh

# Or specify environment explicitly
./setup.sh --wsl    # For WSL development
./setup.sh --rpi    # For Raspberry Pi production
```

### 2. Configure

Edit the configuration files:

**For WSL Development:**
```bash
# Edit environment variables
nano .env

# Edit stream configuration
nano config.json

# Edit credentials (if needed)
nano credentials.json
```

**For Raspberry Pi:**
```bash
# Edit environment variables
sudo nano .env

# Edit stream configuration
sudo nano config.json

# Edit credentials (if needed)
sudo nano credentials.json
```

### 3. Run

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
# On Raspberry Pi
npm start

# Or using systemd service (recommended)
sudo systemctl start veo-dongle.service
```

## Configuration

### Environment Variables (.env)

```bash
# Veo Stream Configuration
VEO_STREAM_URL=https://live.veo.co/stream/YOUR_STREAM_ID
LOGIN_URL=https://live.veo.co/login
LOGIN_ENABLED=true

# Display Configuration
DISPLAY_WIDTH=1920
DISPLAY_HEIGHT=1080

# Server Configuration
PORT=3000
CLOUD_URL=http://localhost:4000

# Device Configuration
DEVICE_ID=raspberry-pi-prod

# Azure Table Storage Configuration (recommended)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=youraccount;AccountKey=yourkey;EndpointSuffix=core.windows.net
AZURE_TABLE_NAME=veoDongleStreams
AZURE_STORAGE_ENABLED=true
AZURE_POLL_INTERVAL=30000
AZURE_RETRY_ATTEMPTS=3

# Environment
NODE_ENV=production
```

### Stream Configuration (config.json)

```json
{
  "veoStreamUrl": "https://live.veo.co/stream/YOUR_STREAM_ID",
  "port": 3000,
  "viewport": {
    "width": 1920,
    "height": 1080
  },
  "login": {
    "url": "https://live.veo.co/login",
    "enabled": true
  },
  "coordinates": {
    "click": { "x": 100, "y": 100 },
    "fullscreen": { "x": 1765, "y": 1045 },
    "playback": { "x": 45, "y": 1052 }
  },
  "chromium": {
    "headless": false,
    "args": [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--start-fullscreen",
      "--kiosk"
    ]
  }
}
```

### Credentials (credentials.json)

```json
{
  "email": "your-veo-email@example.com",
  "password": "your-veo-password"
}
```

## API Reference

### Stream Control Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/control/play` | Start playback |
| POST | `/control/pause` | Pause playback |
| POST | `/control/fullscreen` | Toggle fullscreen |

### Cloud Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cloud/status` | Cloud service status and diagnostics |
| POST | `/cloud/stream` | Update stream URL via API |
| POST | `/cloud/store` | Store stream URL in Azure Table Storage |
| GET | `/cloud/latest` | Get latest stream URL from cloud |
| POST | `/cloud/sync` | Trigger manual cloud sync |

### Recovery Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/recovery` | Recovery mode diagnostics |
| POST | `/recovery/restart` | Manual restart |

### Legacy WebSocket Events (Socket.IO)

> **Note**: These are for backward compatibility with legacy cloud services. Azure Table Storage is recommended for new deployments.

#### Client to Server
- `play` - Start playback
- `pause` - Pause playback
- `fullscreen` - Toggle fullscreen
- `stream` - Update stream URL

#### Server to Client
- `status` - Command status response
- `error` - Error notification

## Cloud Integration

### Azure Table Storage (Recommended)

The Raspberry Pi component now uses Azure Table Storage for reliable cloud interaction, following the same pattern as the BBS (Bulletin Board System) component.

#### Setup Azure Table Storage

1. **Create Azure Storage Account:**
   ```bash
   # Using Azure CLI
   az storage account create \
     --name yourstorageaccount \
     --location eastus \
     --resource-group your-rg \
     --sku Standard_LRS
   ```

2. **Get Connection String:**
   ```bash
   # Using Azure CLI
   az storage account show-connection-string \
     --name yourstorageaccount \
     --resource-group your-rg
   ```

3. **Configure Environment:**
   ```bash
   # In .env file
   AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=youraccount;AccountKey=yourkey;EndpointSuffix=core.windows.net"
   AZURE_TABLE_NAME="veoDongleStreams"
   AZURE_STORAGE_ENABLED=true
   AZURE_POLL_INTERVAL=30000  # 30 seconds
   AZURE_RETRY_ATTEMPTS=3
   ```

#### Cloud Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Management    │───►│  Azure Table    │◄──►│  Raspberry Pi   │
│   Application   │    │   Storage       │    │   Dongle        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Polling       │    │  Chromium       │
                       │   Service       │    │  Browser        │
                       └─────────────────┘    └─────────────────┘
```

#### Device Registration

Each Raspberry Pi device automatically:
- Uses its `DEVICE_ID` as the partition key in Azure Table Storage
- Polls for new stream URLs every 30 seconds (configurable)
- Stores stream URLs with timestamps for history tracking
- Provides REST API endpoints for manual control

### Legacy Socket.IO Support

For backward compatibility, the component still supports the original Socket.IO-based cloud communication:

```bash
# Legacy configuration in .env
CLOUD_URL=http://your-cloud-server:4000
AZURE_STORAGE_ENABLED=false
```

## Development

### WSL Development Setup

1. **Install Dependencies:**
```bash
./setup-wsl.sh
```

2. **Install VcXsrv (Windows X Server):**
   - Download from: https://sourceforge.net/projects/vcxsrv/
   - Start VcXsrv with clipboard and native opengl disabled

3. **Set Display Environment:**
```bash
export DISPLAY=:0
```

4. **Run in Development Mode:**
```bash
npm run dev
```

### Raspberry Pi Production Setup

1. **Install Dependencies:**
```bash
./setup-rpi.sh
```

2. **Enable Service:**
```bash
sudo systemctl enable veo-dongle.service
sudo systemctl start veo-dongle.service
```

3. **Monitor Service:**
```bash
sudo systemctl status veo-dongle.service
sudo journalctl -f -u veo-dongle.service
```

## Troubleshooting

### Common Issues

#### Browser Launch Fails
```bash
# Check if Chromium is installed
which chromium-browser

# Test Puppeteer installation
node -e "const puppeteer = require('puppeteer'); console.log('Puppeteer version:', puppeteer.version);"

# Run diagnostics
curl http://localhost:3000/recovery
```

#### Display Issues in WSL
```bash
# Install VcXsrv on Windows
# Set DISPLAY variable
export DISPLAY=:0

# Check X11 forwarding
xset q
```

#### Permission Issues on Raspberry Pi
```bash
# Fix permissions
sudo chown -R veodongle:veodongle /opt/veo-dongle

# Check service logs
sudo journalctl -f -u veo-dongle.service
```

#### Authentication Problems
1. Verify credentials in `credentials.json`
2. Check if login page URL is correct
3. Enable login in configuration: `"login": { "enabled": true }`

### Recovery Mode

If the browser fails to launch, the application enters recovery mode:

1. **Check Diagnostics:**
   ```bash
   curl http://localhost:3000/recovery
   ```

2. **Manual Restart:**
   ```bash
   curl -X POST http://localhost:3000/recovery/restart
   ```

3. **View Logs:**
   ```bash
   # On Raspberry Pi
   sudo journalctl -f -u veo-dongle.service

   # In development
   npm run dev 2>&1 | tee veo-dongle.log
   ```

### Performance Optimization

#### For Raspberry Pi
- Use 64-bit Raspberry Pi OS
- Allocate at least 4GB RAM to GPU in `raspi-config`
- Disable unnecessary services
- Use SSD storage instead of SD card

#### Memory Management
- Monitor memory usage: `htop`
- Adjust Chromium flags for lower memory usage
- Consider using `pm2` for process management

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cloud Service │◄──►│ Express Server  │◄──►│  Socket.IO      │
│                 │    │ (HTTP API)      │    │ (WebSocket)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Puppeteer     │    │  Chromium       │
                       │ (Browser Ctrl)  │    │ (Stream Display)│
                       └─────────────────┘    └─────────────────┘
```

## Security Considerations

- 🔒 **Credentials Security**: Never commit `credentials.json` to version control
- 🌐 **Network Security**: Use HTTPS in production environments
- 🔐 **Authentication**: Enable login only when necessary
- 📁 **File Permissions**: Use appropriate file permissions on sensitive files
- 🔧 **Updates**: Keep Node.js and dependencies updated

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test in both WSL and Raspberry Pi environments
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review the logs for error messages
3. Test in recovery mode
4. Check the community forums
5. Open an issue on GitHub

## Version History

- **v1.0.0**: Initial release with Puppeteer integration
- **v1.1.0**: Enhanced error handling and recovery mode
- **v1.2.0**: Multi-platform support (WSL/Raspberry Pi)
- **v1.3.0**: Improved authentication and configuration management
