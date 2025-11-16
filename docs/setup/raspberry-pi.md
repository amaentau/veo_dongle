# Raspberry Pi Setup Guide

This guide will help you set up the Raspberry Pi component of the Veo Dongle system.

## Hardware Requirements

- Raspberry Pi 4 or newer (recommended)
- MicroSD card (32GB or larger)
- Power supply (official Raspberry Pi power supply recommended)
- Ethernet cable or WiFi dongle (for network connectivity)
- HDMI cable and display (for initial setup)

## Software Prerequisites

### Operating System
- Raspberry Pi OS (64-bit) - Lite or Desktop version
- Latest updates installed

### System Packages
```bash
sudo apt update
sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Chromium
sudo apt install -y chromium-browser

# Install additional dependencies
sudo apt install -y libnss3-dev libatk-bridge2.0-dev libdrm2 libxkbcommon-dev libxss1 libasound2
```

## Automated Raspberry Pi Lite Setup

Use the curated script at `raspberry-pi/setup-lite.sh` to bootstrap a fresh Raspberry Pi OS Lite image with everything the `raspberry-pi` component needs. The script:

- creates the `dongle` user, adds it to `video`, `render`, `input`, `dialout`, and `sudo`, and chowns the application tree
- installs Node.js 20, Chromium, Xorg, X11 utilities, and the Chromium runtime libraries required for Puppeteer
- writes `/etc/X11/xorg.conf.d/99-veo-modesetting.conf` so the `modesetting` driver is forced with `Virtual 3840x2160` and the common HD/FullHD/4K modes
- writes `/etc/systemd/system/veo-dongle-kiosk.service`, which starts `xinit` as the `dongle` user, runs `raspberry-pi/scripts/start-kiosk.sh`, and keeps Chromium in fullscreen kiosk mode on `DISPLAY=:0`
- skips Puppeteer’s embedded Chromium download (`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1`) so the application always receives the system browser defined by `config.browser.executablePath`
- symlinks `/usr/bin/chromium-browser`, `/usr/bin/chromium`, and `/usr/bin/google-chrome-stable` to the installed binary so both Puppeteer and any scripts that expect Chrome will succeed

### Running the Lite setup script

```bash
sudo mkdir -p /home/dongle
sudo git clone https://github.com/your-org/veo_dongle.git /home/dongle/veo_dongle
cd /home/dongle/veo_dongle/raspberry-pi
sudo ./setup-lite.sh
```

After the script completes the kiosk service is enabled automatically:

```bash
sudo journalctl -f -u veo-dongle-kiosk.service
```

### Configuration strategy for Raspberry vs WSL

`setup-lite.sh` reads `raspberry-pi/config.json` so the same repository can drive both the kiosk deployment and WSL development environments. Edit the `display` block to list the HDMI modes that your monitor supports (`"3840x2160"`, `"1920x1080"`, and `"1280x720"` are all configured by default) and set `preferredMode` to `auto` or to a hard constraint if the display mis-reports its native resolution.

The `environments` block inside `config.json` holds overrides for `raspberry` (production) and `wsl` (development). The `raspberry` overrides enable EGL-based GPU hints and keep the full-screen Chromium flags used by the kiosk; the WSL overrides shrink the viewport and add SwiftShader/ANGLE fallbacks so the browser launches inside Windows. The systemd service exports `RUNTIME_ENV=raspberry`, so Node.js merges the Raspberry-specific overrides automatically while running on the Pi.

If you change the source tree later, run `sudo -u dongle npm install --omit=dev` before restarting `veo-dongle-kiosk.service`.

## Project Setup

### 1. Clone or Download the Project

```bash
cd ~
git clone <your-repo-url> veo-dongle
cd veo-dongle/raspberry-pi
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure the Application

```bash
cp config.example.js config.js
```

Edit `config.js` with your settings:

```javascript
module.exports = {
  // Your Veo stream URL
  veoStreamUrl: "https://your-veo-stream-url.com",

  // Local control port
  port: 3000,

  // Cloud service URL (if using remote control)
  cloudUrl: "http://your-cloud-server.com:4000",

  // Device identifier
  deviceId: "raspberry-pi-living-room",

  // Chromium configuration
  chromium: {
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--start-fullscreen',
      '--kiosk',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  }
};
```

## Testing the Setup

### 1. Test Chromium Launch

```bash
# Test basic Chromium functionality
chromium-browser --no-sandbox --version

# Test fullscreen mode
chromium-browser --no-sandbox --start-fullscreen --kiosk https://example.com
```

### 2. Test Node.js Application

```bash
# Start the application
npm start
```

You should see output like:
```
Initializing Veo Dongle Raspberry Pi...
Launching Chromium browser...
Chromium browser launched successfully
Navigating to veo stream: https://your-veo-stream-url.com
Successfully loaded veo stream
Veo Dongle ready. Access control interface at http://localhost:3000
```

### 3. Test Local Control API

```bash
# Test health endpoint
curl http://localhost:3000/health

# Test play command
curl -X POST http://localhost:3000/control/play

# Test fullscreen command
curl -X POST http://localhost:3000/control/fullscreen
```

## Auto-start Configuration

### Using systemd (Recommended)

1. Create a systemd service file:

```bash
sudo nano /etc/systemd/system/veo-dongle.service
```

2. Add the following content:

```ini
[Unit]
Description=Veo Dongle Raspberry Pi Service
After=network.target graphical.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/veo-dongle/raspberry-pi
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=graphical.target
```

3. Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable veo-dongle
sudo systemctl start veo-dongle
sudo systemctl status veo-dongle
```

### Using Cron (@reboot)

1. Edit crontab:

```bash
crontab -e
```

2. Add the following line:

```bash
@reboot cd /home/pi/veo-dongle/raspberry-pi && /usr/bin/node src/index.js
```

## Troubleshooting

### Common Issues

#### 1. Chromium Won't Start
**Symptoms**: Application fails to launch browser
**Solutions**:
- Check if Chromium is installed: `which chromium-browser`
- Verify display is connected and working
- Try running without kiosk mode first
- Check system resources (RAM, CPU)

#### 2. Stream Won't Load
**Symptoms**: Browser opens but stream doesn't play
**Solutions**:
- Verify the Veo stream URL is correct and accessible
- Check network connectivity
- Try loading the URL manually in Chromium
- Check for authentication requirements

#### 3. Fullscreen Mode Not Working
**Symptoms**: Browser starts but not in fullscreen
**Solutions**:
- Ensure display is properly connected
- Check Chromium command line arguments
- Try different fullscreen flags
- Verify no other window manager interference

#### 4. Application Crashes on Startup
**Symptoms**: Node.js process exits immediately
**Solutions**:
- Check Node.js version: `node --version`
- Verify all dependencies are installed: `npm list`
- Check configuration file syntax
- Review application logs

### Log Files

#### systemd Logs
```bash
# View service logs
sudo journalctl -u veo-dongle -f

# View recent logs
sudo journalctl -u veo-dongle -n 50
```

#### Application Logs
The application logs to console by default. For persistent logging, you can redirect output:

```bash
# In systemd service file, add:
StandardOutput=journal
StandardError=journal
```

### Performance Optimization

#### Memory Management
```bash
# Check memory usage
free -h

# Monitor process
top -p $(pgrep node)
```

#### Disable Unnecessary Services
```bash
# Stop unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable avahi-daemon
```

#### GPU Memory Allocation
Edit `/boot/config.txt`:
```
gpu_mem=256
```

## Network Configuration

### Static IP (Recommended for Production)

1. Edit dhcpcd configuration:

```bash
sudo nano /etc/dhcpcd.conf
```

2. Add static IP configuration:

```bash
interface eth0
static ip_address=192.168.1.100/24
static routers=192.168.1.1
static domain_name_servers=192.168.1.1
```

3. Restart networking:

```bash
sudo systemctl restart dhcpcd
```

### Firewall Configuration

```bash
# Allow SSH (if needed)
sudo ufw allow ssh

# Allow Veo Dongle port
sudo ufw allow 3000

# Enable firewall
sudo ufw enable
```

## Security Considerations

### User Permissions
- Run the service as non-root user (pi)
- Use minimal required permissions
- Avoid running as root

### Network Security
- Use HTTPS for cloud communications
- Implement proper authentication
- Keep system updated

### Physical Security
- Secure physical access to the device
- Use official power supplies
- Protect against power surges

## Monitoring

### Health Checks
```bash
# Check if service is running
sudo systemctl is-active veo-dongle

# Check application health
curl http://localhost:3000/health
```

### System Monitoring
```bash
# System resources
htop

# Network connections
netstat -tlnp

# Disk usage
df -h
```

## Backup and Recovery

### Backup Configuration
```bash
# Backup application files
tar -czf veo-dongle-backup.tar.gz ~/veo-dongle

# Backup systemd configuration
sudo cp /etc/systemd/system/veo-dongle.service ~/veo-dongle-backup/
```

### Recovery Procedure
1. Restore from backup
2. Reinstall dependencies: `npm install`
3. Restore systemd service: `sudo cp veo-dongle.service /etc/systemd/system/`
4. Reload systemd: `sudo systemctl daemon-reload`
5. Start service: `sudo systemctl start veo-dongle`

## Support

For additional help:
1. Check the application logs
2. Verify network connectivity
3. Test individual components
4. Consult the main project documentation









