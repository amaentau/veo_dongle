# Veo Dongle

A multi-platform system for Veo stream playback and remote control, consisting of:

- **Raspberry Pi Component**: Runs on Raspberry Pi to display Veo streams in Chromium with full screen mode
- **Cloud Service**: Central service for device management and command routing
- **Mobile App**: React Native app for iOS/Android to control devices remotely

## Project Structure

```
veo-dongle/
├── raspberry-pi/          # Raspberry Pi component
│   ├── src/
│   │   ├── stream/        # Stream handling logic
│   │   ├── control/       # Local control interface
│   │   └── index.js       # Main application
│   ├── package.json
│   └── config.example.js
├── cloud/                 # Cloud service component
│   ├── src/
│   │   ├── api/           # REST API endpoints
│   │   ├── models/        # Database models
│   │   └── index.js       # Main cloud service
│   ├── package.json
│   └── config.example.js
├── mobile/                # React Native mobile app
│   ├── src/
│   │   ├── screens/       # App screens
│   │   ├── components/    # Reusable components
│   │   ├── services/      # API services
│   │   └── App.js         # Main app component
│   └── package.json
├── shared/                # Shared configuration and types
│   ├── config/
│   └── types/
├── docs/                  # Documentation
│   ├── architecture/
│   └── setup/
└── package.json           # Root package management
```

## Prerequisites

### Raspberry Pi Setup
- Raspberry Pi (recommended: Raspberry Pi 4 or newer)
- Raspbian OS
- Node.js 16+
- Chromium browser

### Cloud Service Setup
- Node.js 16+
- MongoDB (optional, for device persistence)

### Mobile App Setup
- Node.js 16+
- React Native development environment
- Android Studio (for Android development)
- Xcode (for iOS development, macOS only)

## Quick Start

### 1. Install Dependencies

```bash
# Install all dependencies
npm run install:all

# Or install individually
npm run install:raspberry
npm run install:cloud
npm run install:mobile
```

### 2. Configure Components

#### Raspberry Pi Configuration
```bash
cd raspberry-pi
cp config.example.js config.js
# Edit config.js with your veo stream URL and settings
```

#### Cloud Service Configuration
```bash
cd cloud
cp config.example.js config.js
# Edit config.js with MongoDB URI and other settings
```

#### Mobile App Configuration
The mobile app will automatically connect to `http://localhost:4000` by default.
Update the cloud URL in the app settings if needed.

### 3. Start Components

#### Start Cloud Service First
```bash
npm run start:cloud
```

#### Start Raspberry Pi Component
```bash
npm run start:raspberry
```

#### Start Mobile App Development
```bash
# For Android
npm run android

# For iOS (macOS only)
npm run ios
```

## Raspberry Pi Component

The Raspberry Pi component:
- Launches Chromium in kiosk mode
- Loads and displays Veo streams
- Supports coordinate-based UI interaction (from your existing config)
- Automatically enters fullscreen mode
- Provides local HTTP API for control
- Supports WebSocket connections for real-time control
- Uses JSON configuration files (compatible with your existing setup)

### Local Control API

```
GET  /health           # Health check
POST /control/play     # Play stream
POST /control/pause    # Pause stream
POST /control/fullscreen # Toggle fullscreen
```

### Command Line Usage

```bash
# Start with stream URL from config.json
npm run play

# Start with specific stream URL
npm run play https://your-stream-url.com

# Show help
npm run help

# Show version
npm run version
```

### Authentication & Configuration

The Raspberry Pi component supports secure authentication and flexible configuration:

#### Credentials (credentials.json)
```json
{
  "email": "your-email@domain.com",
  "password": "your-password"
}
```
⚠️ **Important**: This file is automatically excluded from Git and should never be committed.

#### Configuration (config.json)
```json
{
  "veoStreamUrl": "https://your-veo-stream.com",
  "port": 3000,
  "login": {
    "url": "https://live.veo.co/login",
    "enabled": true
  },
  "coordinates": {
    "fullscreen": { "x": 1765, "y": 1045 },
    "playback": { "x": 45, "y": 1052 },
    "click": { "x": 100, "y": 100 }
  },
  "viewport": {
    "width": 1920,
    "height": 1080
  }
}
```

#### Authentication Workflow
1. **Credentials Check**: Looks for `credentials.json` in the raspberry-pi directory
2. **Login Process**: If credentials exist and login is enabled:
   - Navigates to the login URL (default: https://live.veo.co/login)
   - Fills email and password fields
   - Submits the login form
   - Waits for successful authentication
3. **Stream Navigation**: After authentication, navigates to the specified stream URL
4. **Auto-Controls**: Automatically triggers fullscreen and playback using coordinates

#### JavaScript Configuration (config.js)
```javascript
{
  streamUrl: "https://your-veo-stream.com",
  port: 3000,
  chromium: {
    headless: false,
    args: ["--start-fullscreen", "--kiosk"]
  }
}
```

## Cloud Service

The cloud service provides:
- Device registration and management
- Command routing between mobile apps and devices
- Real-time communication via WebSocket
- REST API for device control

### API Endpoints

```
GET  /health           # Service health
GET  /devices          # List connected devices
POST /devices/register # Register new device
POST /control/:deviceId/:command # Send command to device
```

## Mobile App

The React Native mobile app provides:
- Device discovery and listing
- Real-time device control
- Stream playback controls (play/pause/fullscreen)
- Settings for cloud service configuration

### Features
- **Device List**: Discover and connect to available devices
- **Device Control**: Control individual devices with real-time feedback
- **Settings**: Configure cloud service URL and app preferences

## Development

### Running in Development Mode

```bash
# Raspberry Pi (with auto-restart)
npm run dev:raspberry

# Cloud service (with auto-restart)
npm run dev:cloud

# Mobile app (metro bundler)
npm run dev:mobile
```

### Testing

```bash
# Run tests for all components
npm run test:all

# Run tests individually
npm run test:raspberry
npm run test:cloud
npm run test:mobile
```

## Deployment

### Raspberry Pi Deployment

1. Set up auto-start on boot:
   ```bash
   # Create systemd service
   sudo nano /etc/systemd/system/veo-dongle.service
   ```

   ```ini
   [Unit]
   Description=Veo Dongle Raspberry Pi Service
   After=network.target

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/veo-dongle/raspberry-pi
   ExecStart=/usr/bin/node src/index.js
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

2. Enable and start the service:
   ```bash
   sudo systemctl enable veo-dongle
   sudo systemctl start veo-dongle
   ```

### Cloud Service Deployment

1. Set up production environment variables
2. Configure reverse proxy (nginx)
3. Set up SSL certificates
4. Configure MongoDB for production

### Mobile App Deployment

1. Build for Android:
   ```bash
   cd mobile
   npx react-native build-android --mode=release
   ```

2. Build for iOS:
   ```bash
   cd mobile
   npx react-native build-ios --mode=release
   ```

## Architecture

The system follows a distributed architecture:

1. **Raspberry Pi devices** run the stream player and expose local control APIs
2. **Cloud service** acts as a central hub for device management and command routing
3. **Mobile apps** connect to the cloud service to discover and control devices
4. **Real-time communication** is handled via WebSocket connections

## Security Considerations

- Configure CORS properly for production
- Use HTTPS/WSS for all communications
- Implement proper authentication for device registration
- Validate all input data
- Use environment variables for sensitive configuration

## Troubleshooting

### Common Issues

1. **Raspberry Pi won't start fullscreen**
   - Check Chromium arguments in config
   - Ensure kiosk mode is enabled

2. **Mobile app can't connect to cloud**
   - Verify cloud service is running
   - Check network connectivity
   - Update cloud URL in app settings

3. **Devices not appearing in mobile app**
   - Ensure Raspberry Pi is connected to cloud service
   - Check device registration process
   - Verify WebSocket connections

### Logs

Check logs for each component:
- Raspberry Pi: Console output or systemd logs
- Cloud: Console output
- Mobile: Metro bundler logs and device logs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details
