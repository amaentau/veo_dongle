const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.reboot_history');
const MARKER_FILE = '/tmp/force_provisioning';
const WINDOW_MS = 90000; // 90 seconds
const THRESHOLD = 3;

function checkRebootLoop() {
  const now = Date.now();
  let history = [];

  try {
    if (fs.existsSync(STATE_FILE)) {
      history = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    // Ignore read errors, start fresh
  }

  // Ensure history is an array
  if (!Array.isArray(history)) {
    history = [];
  }

  // Add current boot time
  history.push(now);

  // Filter out timestamps older than WINDOW_MS
  history = history.filter(ts => (now - ts) <= WINDOW_MS);

  // Save updated history
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(history));
  } catch (e) {
    console.error('Failed to save reboot history:', e.message);
  }

  // Check if threshold is met
  if (history.length >= THRESHOLD) {
    console.log(`⚠️  Detected ${history.length} reboots in ${WINDOW_MS/1000}s.`);
    try {
      fs.writeFileSync(MARKER_FILE, 'true');
      console.log(`CHECK: Created marker file ${MARKER_FILE}`);
    } catch (e) {
      console.error('CHECK: Failed to create marker file:', e.message);
    }
    return true; // Trigger provisioning
  }

  return false;
}

if (require.main === module) {
  if (checkRebootLoop()) {
    process.exit(1); // Signal loop detected
  } else {
    process.exit(0); // Normal boot
  }
}

