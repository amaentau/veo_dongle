const express = require('express');
const cors = require('cors');
const path = require('path');
const { TableClient } = require('@azure/data-tables');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// --- Configuration ---
// For local development, this reads from a .env file if present
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod-123';
const BREVO_SMTP_KEY = process.env.BREVO_SMTP_KEY; 
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER;
const BREVO_SMTP_HOST = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
const BREVO_SMTP_PORT = parseInt(process.env.BREVO_SMTP_PORT) || 587;
const FROM_EMAIL = (process.env.FROM_EMAIL || 'noreply@espa-tv.com').trim();
const FROM_NAME = (process.env.FROM_NAME || 'Espa TV Auth').trim();

const TABLE_NAME_ENTRIES = process.env.TABLE_NAME || 'bbsEntries';
const TABLE_NAME_USERS = 'bbsUsers'; 
const TABLE_NAME_CONFIG = 'bbsConfig';
const TABLE_NAME_DEVICES = 'bbsDevices';
const TABLE_NAME_PERMISSIONS = 'bbsPermissions';
const STORAGE_CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING;

// Setup Nodemailer Transporter
let mailTransporter = null;
if (BREVO_SMTP_KEY && BREVO_SMTP_USER) {
  mailTransporter = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: BREVO_SMTP_PORT,
    secure: false, // true for 465, false for other ports (STARTTLS)
    auth: {
      user: BREVO_SMTP_USER,
      pass: BREVO_SMTP_KEY,
    },
  });
} else {
  console.warn('⚠️ Brevo Credentials (BREVO_SMTP_USER/BREVO_SMTP_KEY) not found. Email sending will be mocked.');
}

// Basic Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- MOCK STORAGE IMPLEMENTATION ---
const mockDb = {
  [TABLE_NAME_ENTRIES]: [],
  [TABLE_NAME_USERS]: [],
  [TABLE_NAME_CONFIG]: [],
  [TABLE_NAME_DEVICES]: [],
  [TABLE_NAME_PERMISSIONS]: []
};

// Default Config
mockDb[TABLE_NAME_CONFIG].push({
  partitionKey: 'global',
  rowKey: 'coordinates',
  config: JSON.stringify({
    1280: { play: { x: 63, y: 681 }, fullscreen: { x: 1136, y: 678 } },
    1920: { play: { x: 87, y: 1032 }, fullscreen: { x: 1771, y: 1032 } },
    3840: { play: { x: 114, y: 2124 }, fullscreen: { x: 3643, y: 2122 } }
  })
});

class MockTableClient {
  constructor(tableName) { this.tableName = tableName; }
  async createTable() { return true; }
  
  async getEntity(partitionKey, rowKey) {
    const item = mockDb[this.tableName].find(i => i.partitionKey === partitionKey && i.rowKey === rowKey);
    if (!item) {
      const err = new Error('Not Found');
      err.statusCode = 404;
      throw err;
    }
    return { ...item };
  }

  async upsertEntity(entity) {
    const idx = mockDb[this.tableName].findIndex(i => i.partitionKey === entity.partitionKey && i.rowKey === entity.rowKey);
    if (idx >= 0) mockDb[this.tableName][idx] = { ...mockDb[this.tableName][idx], ...entity };
    else mockDb[this.tableName].push(entity);
  }

  async createEntity(entity) {
    return this.upsertEntity(entity);
  }

  async updateEntity(entity, mode) {
    await this.upsertEntity(entity);
  }

  async deleteEntity(partitionKey, rowKey) {
    const idx = mockDb[this.tableName].findIndex(i => i.partitionKey === partitionKey && i.rowKey === rowKey);
    if (idx >= 0) mockDb[this.tableName].splice(idx, 1);
  }

  async *listEntities({ queryOptions }) {
    let items = mockDb[this.tableName];
    if (queryOptions && queryOptions.filter) {
      const pMatch = queryOptions.filter.match(/PartitionKey eq '(.+?)'/);
      if (pMatch) {
        const key = pMatch[1].replace(/''/g, "'");
        items = items.filter(i => i.partitionKey === key);
      }
      const rMatch = queryOptions.filter.match(/RowKey eq '(.+?)'/);
      if (rMatch) {
        const key = rMatch[1].replace(/''/g, "'");
        items = items.filter(i => i.rowKey === key);
      }
    }
    for (const item of items) yield item;
  }
}

// --- Azure Tables Helpers ---
function getTableClient(tableName) {
  if (!STORAGE_CONNECTION_STRING) {
    return new MockTableClient(tableName);
  }
  return TableClient.fromConnectionString(STORAGE_CONNECTION_STRING, tableName);
}

async function ensureTablesExist() {
  const tables = [TABLE_NAME_ENTRIES, TABLE_NAME_USERS, TABLE_NAME_CONFIG, TABLE_NAME_DEVICES, TABLE_NAME_PERMISSIONS];
  for (const t of tables) {
    try {
      const client = getTableClient(t);
      await client.createTable();
    } catch (err) {
      if (!/TableAlreadyExists/i.test(err.message)) console.error(`Error ensuring table ${t}:`, err);
    }
  }
}

async function isFirstUser() {
  const client = getTableClient(TABLE_NAME_USERS);
  const iter = client.listEntities({ queryOptions: { filter: "RowKey eq 'profile'" } });
  const first = await iter.next();
  return first.done; 
}

if (!STORAGE_CONNECTION_STRING) {
  console.warn('⚠️ No STORAGE_CONNECTION_STRING. Using In-Memory Mock Database.');
} else {
  ensureTablesExist();
}

// --- Helper Functions ---
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

async function sendEmail(to, subject, text) {
  if (!mailTransporter) {
    console.log(`[MOCK EMAIL] To: ${to} | Subject: ${subject} | Body: ${text}`);
    return;
  }
  
  try {
    await mailTransporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`, // Use configured sender
      to,
      subject,
      text,
      html: `<strong>${text}</strong>`,
    });
    console.log(`📧 Email sent to ${to}`);
  } catch (error) {
    console.error('❌ SMTP Error:', error);
    throw new Error('Email sending failed');
  }
}

// --- Middleware: Verify JWT ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// --- Auth API Endpoints ---

// 1. Lookup
app.post('/auth/lookup', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    const user = await client.getEntity(email, 'profile');
    return res.json({ exists: true, isAdmin: !!user.isAdmin });
  } catch (err) {
    if (err.statusCode === 404) return res.json({ exists: false });
    console.error('Lookup error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// 2. Send OTP
app.post('/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const otp = generateOTP();
  const expires = Date.now() + 10 * 60 * 1000; 

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    await client.upsertEntity({
      partitionKey: email,
      rowKey: 'otp',
      code: otp,
      expires
    });

    await sendEmail(email, 'ESPA TV: Vahvistuskoodisi', `Tervetuloa ESPA TV -palveluun. Vahvistuskoodisi on: ${otp}`);
    return res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    console.error('Send OTP error:', err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 3. Verify OTP
app.post('/auth/verify-otp', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    const otpEntity = await client.getEntity(email, 'otp');

    if (!otpEntity || String(otpEntity.code) !== String(code)) {
      return res.status(401).json({ error: 'Invalid code' });
    }
    if (Date.now() > otpEntity.expires) {
      return res.status(401).json({ error: 'Code expired' });
    }

    const setupToken = jwt.sign({ email, purpose: 'setup' }, JWT_SECRET, { expiresIn: '15m' });
    await client.deleteEntity(email, 'otp');

    return res.json({ ok: true, setupToken });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// --- Device & Discovery Endpoints ---

// 1. List my devices
app.get('/devices', authenticateToken, async (req, res) => {
  try {
    const email = req.user.email;
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);

    const filter = `PartitionKey eq '${email.replace(/'/g, "''")}'`;
    const permissions = [];
    for await (const perm of permClient.listEntities({ queryOptions: { filter } })) {
      permissions.push({
        deviceId: perm.rowKey,
        role: perm.role
      });
    }

    // Enhance with device metadata (names, etc.)
    const devices = [];
    for (const perm of permissions) {
      try {
        const device = await deviceClient.getEntity(perm.deviceId, 'metadata');
        devices.push({
          id: perm.deviceId,
          role: perm.role,
          friendlyName: device.friendlyName || perm.deviceId,
          masterEmail: device.masterEmail
        });
      } catch (err) {
        // Fallback if metadata is missing (legacy)
        devices.push({
          id: perm.deviceId,
          role: perm.role,
          friendlyName: perm.deviceId,
          masterEmail: perm.role === 'master' ? email : 'unknown'
        });
      }
    }

    return res.json(devices);
  } catch (err) {
    console.error('GET /devices error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Claim a device (Master only)
app.post('/devices/claim', authenticateToken, async (req, res) => {
  try {
    const { deviceId, friendlyName } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    // Check if device already has a master
    let existingDevice;
    try {
      existingDevice = await deviceClient.getEntity(deviceId, 'metadata');
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    if (existingDevice && existingDevice.masterEmail && existingDevice.masterEmail !== email) {
      return res.status(403).json({ error: 'Device already claimed by another user' });
    }

    // Upsert Device Metadata
    await deviceClient.upsertEntity({
      partitionKey: deviceId,
      rowKey: 'metadata',
      friendlyName: friendlyName || deviceId,
      masterEmail: email,
      createdAt: existingDevice ? existingDevice.createdAt : new Date().toISOString()
    });

    // Upsert Permission
    await permClient.upsertEntity({
      partitionKey: email,
      rowKey: deviceId,
      role: 'master',
      addedBy: 'user-claim'
    });

    return res.json({ ok: true, deviceId });
  } catch (err) {
    console.error('POST /devices/claim error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. List shares for a device (Master only)
app.get('/devices/:deviceId/shares', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    // Verify requester is Master
    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can manage shares' });
    }

    // Get all permissions for this deviceId
    // Note: Permissions table PartitionKey is email, RowKey is deviceId.
    // To find all emails for a device, we'd ideally have an index or a secondary table.
    // For a minimal implementation with Azure Tables without a secondary index, we can scan or filter by RowKey.
    // Given the scale, filtering by RowKey is acceptable if PartitionKey isn't known.
    
    const results = [];
    const iter = permClient.listEntities({ queryOptions: { filter: `RowKey eq '${deviceId.replace(/'/g, "''")}'` } });
    for await (const perm of iter) {
      results.push({
        email: perm.partitionKey,
        role: perm.role,
        addedBy: perm.addedBy
      });
    }

    return res.json(results);
  } catch (err) {
    console.error('GET /shares error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 4. Share device with another user
app.post('/devices/:deviceId/share', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { email: targetEmail } = req.body;
    const email = req.user.email;

    if (!targetEmail || !targetEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    // Verify requester is Master
    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can share' });
    }

    // Create permission for target email
    await permClient.upsertEntity({
      partitionKey: targetEmail.toLowerCase().trim(),
      rowKey: deviceId,
      role: 'contributor',
      addedBy: email
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /share error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 5. Remove share
app.delete('/devices/:deviceId/share/:targetEmail', authenticateToken, async (req, res) => {
  try {
    const { deviceId, targetEmail } = req.params;
    const email = req.user.email;

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    // Verify requester is Master
    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can manage shares' });
    }

    if (targetEmail === device.masterEmail) {
      return res.status(400).json({ error: 'Cannot remove the master user' });
    }

    await permClient.deleteEntity(targetEmail, deviceId);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /share error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 6. Release/Delete Device (Master only)
app.delete('/devices/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const email = req.user.email;

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    // 1. Verify requester is Master
    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can release the device' });
    }

    // 2. Delete all permissions for this device
    // Since PartitionKey is email and RowKey is deviceId, we scan/filter by RowKey
    const iter = permClient.listEntities({ queryOptions: { filter: `RowKey eq '${deviceId.replace(/'/g, "''")}'` } });
    for await (const perm of iter) {
      await permClient.deleteEntity(perm.partitionKey, perm.rowKey);
    }

    // 3. Delete device metadata
    await deviceClient.deleteEntity(deviceId, 'metadata');

    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /devices error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 7. Update Device Name (Master only)
app.patch('/devices/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { friendlyName } = req.body;
    const email = req.user.email;

    if (!friendlyName) return res.status(400).json({ error: 'friendlyName required' });

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);

    // Verify requester is Master
    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can rename the device' });
    }

    // Update Name
    await deviceClient.updateEntity({
      partitionKey: deviceId,
      rowKey: 'metadata',
      friendlyName: friendlyName.trim()
    }, "Merge");

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /devices error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 8. Device Announcement (Public for Pi provisioning)
app.post('/devices/announce', async (req, res) => {
  try {
    const { deviceId, email, friendlyName } = req.body;
    if (!deviceId || !email || !friendlyName) return res.status(400).json({ error: 'Missing fields' });

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    // 1. Check existing registration
    let existingDevice;
    try {
      existingDevice = await deviceClient.getEntity(deviceId, 'metadata');
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    // 2. Handle Change of Hands / Takeover
    if (existingDevice && existingDevice.masterEmail && existingDevice.masterEmail !== email) {
      console.log(`🔄 Device ${deviceId} changing hands from ${existingDevice.masterEmail} to ${email}`);
      
      // Revoke ALL existing permissions for this device to ensure a clean slate
      try {
        const iter = permClient.listEntities({ 
          queryOptions: { filter: `RowKey eq '${deviceId.replace(/'/g, "''")}'` } 
        });
        for await (const perm of iter) {
          await permClient.deleteEntity(perm.partitionKey, perm.rowKey);
          console.log(`🚫 Revoked permission for ${perm.partitionKey} on device ${deviceId}`);
        }
      } catch (e) {
        console.warn(`⚠️ Failed to fully revoke old permissions for ${deviceId}:`, e.message);
      }
    }

    // 3. Register or Update Device Metadata
    // We only overwrite a custom friendly name with a default one if the owner changed
    let finalFriendlyName = friendlyName;
    const isDefaultName = friendlyName.startsWith('ESPA-Pi-') || friendlyName === deviceId;
    const ownerChanged = existingDevice && existingDevice.masterEmail !== email;

    if (existingDevice && !ownerChanged && isDefaultName && existingDevice.friendlyName && !existingDevice.friendlyName.startsWith('ESPA-Pi-')) {
      // Preserve the custom name already in Azure if the Pi sent a fallback default
      finalFriendlyName = existingDevice.friendlyName;
    }

    await deviceClient.upsertEntity({
      partitionKey: deviceId,
      rowKey: 'metadata',
      friendlyName: finalFriendlyName || deviceId,
      masterEmail: email,
      createdAt: existingDevice ? existingDevice.createdAt : new Date().toISOString(),
      lastAnnouncedAt: new Date().toISOString()
    });

    // 4. Ensure the new/current owner has Master permission
    await permClient.upsertEntity({
      partitionKey: email,
      rowKey: deviceId,
      role: 'master',
      addedBy: 'pi-announcement'
    });

    return res.json({ 
      ok: true, 
      status: existingDevice ? (existingDevice.masterEmail === email ? 'updated' : 'transferred') : 'registered' 
    });
  } catch (err) {
    console.error('POST /devices/announce error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Permission Helpers ---
async function checkAndAutoProvision(email, deviceId) {
  const permClient = getTableClient(TABLE_NAME_PERMISSIONS);
  const deviceClient = getTableClient(TABLE_NAME_DEVICES);

  try {
    // Check if permission already exists
    await permClient.getEntity(email, deviceId);
    return true; 
  } catch (err) {
    if (err.statusCode !== 404) throw err;

    // Legacy/Auto-provision: If deviceId is the user's email, or if it's a new device and they are the first to use it
    if (deviceId === email) {
      console.log(`Auto-provisioning legacy permission for ${email} on device ${deviceId}`);
      
      // 1. Ensure Device exists
      try {
        await deviceClient.getEntity(deviceId, 'metadata');
      } catch (devErr) {
        if (devErr.statusCode === 404) {
          await deviceClient.createEntity({
            partitionKey: deviceId,
            rowKey: 'metadata',
            friendlyName: `Legacy Device (${email})`,
            masterEmail: email,
            createdAt: new Date().toISOString()
          });
        }
      }

      // 2. Create Permission
      await permClient.upsertEntity({
        partitionKey: email,
        rowKey: deviceId,
        role: 'master',
        addedBy: 'system-legacy'
      });
      return true;
    }
    return false;
  }
}

// 4. Set PIN
app.post('/auth/set-pin', async (req, res) => {
  const { pin, setupToken } = req.body;
  if (!pin || !setupToken) return res.status(400).json({ error: 'Missing fields' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });

  try {
    const decoded = jwt.verify(setupToken, JWT_SECRET);
    if (decoded.purpose !== 'setup') return res.status(403).json({ error: 'Invalid token purpose' });

    const email = decoded.email;
    const pinHash = await bcrypt.hash(pin, 10);

    const client = getTableClient(TABLE_NAME_USERS);
    
    // Check if this is the FIRST user ever
    const makeAdmin = await isFirstUser();

    // Create Profile
    await client.upsertEntity({
      partitionKey: email,
      rowKey: 'profile',
      pinHash,
      isAdmin: makeAdmin, // Set admin flag if first user
      failedAttempts: 0,
      lockedUntil: 0
    });

    const token = jwt.sign({ email, isAdmin: makeAdmin }, JWT_SECRET, { expiresIn: '180d' });
    return res.json({ ok: true, token, email, isAdmin: makeAdmin });

  } catch (err) {
    console.error('Set PIN error:', err);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
});

// 5. Login
app.post('/auth/login', async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'Missing fields' });

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    const user = await client.getEntity(email, 'profile');

    if (user.lockedUntil && Date.now() < user.lockedUntil) {
      const waitMinutes = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Account locked. Try again in ${waitMinutes} minutes.` });
    }

    const match = await bcrypt.compare(pin, user.pinHash);
    
    if (!match) {
      const attempts = (user.failedAttempts || 0) + 1;
      let lockedUntil = user.lockedUntil || 0;
      if (attempts >= 3) lockedUntil = Date.now() + 15 * 60 * 1000;

      await client.updateEntity({
        partitionKey: email,
        rowKey: 'profile',
        failedAttempts: attempts,
        lockedUntil: lockedUntil
      }, "Merge");

      return res.status(401).json({ error: attempts >= 3 ? 'Locked. Too many failed attempts.' : 'Invalid PIN' });
    }

    // Success
    if (user.failedAttempts > 0) {
      await client.updateEntity({ partitionKey: email, rowKey: 'profile', failedAttempts: 0, lockedUntil: 0 }, "Merge");
    }

    const token = jwt.sign({ email, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: '180d' });
    return res.json({ ok: true, token, email, isAdmin: !!user.isAdmin });

  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'User not found' });
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});


// --- Config Endpoints (Coordinates) ---

// GET /config/coordinates (Public for RPi, but could be auth'd)
app.get('/config/coordinates', async (req, res) => {
  try {
    const client = getTableClient(TABLE_NAME_CONFIG);
    const entity = await client.getEntity('global', 'coordinates');
    // Azure tables stores JSON as string, parse it back
    return res.json(JSON.parse(entity.config));
  } catch (err) {
    // Return defaults if not found
    return res.json({
      1280: { play: { x: 63, y: 681 }, fullscreen: { x: 1136, y: 678 } },
      1920: { play: { x: 87, y: 1032 }, fullscreen: { x: 1771, y: 1032 } },
      3840: { play: { x: 114, y: 2124 }, fullscreen: { x: 3643, y: 2122 } }
    });
  }
});

// POST /config/coordinates (Admin Only)
app.post('/config/coordinates', authenticateToken, async (req, res) => {
  if (!req.user.isAdmin) return res.sendStatus(403);
  
  const newConfig = req.body; // Expect full JSON object
  if (!newConfig || !newConfig['1920']) return res.status(400).json({ error: 'Invalid config format' });

  try {
    const client = getTableClient(TABLE_NAME_CONFIG);
    await client.upsertEntity({
      partitionKey: 'global',
      rowKey: 'coordinates',
      config: JSON.stringify(newConfig)
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Config save error:', err);
    return res.status(500).json({ error: 'Failed to save config' });
  }
});


// --- App Endpoints ---
app.post('/entry', authenticateToken, async (req, res) => {
  try {
    const { key, value1, value2 } = req.body || {};
    if (!key || !value1) return res.status(400).json({ error: 'key and value1 required' });

    // Step 1: Permission Check (Legacy compatibility included)
    const hasAccess = await checkAndAutoProvision(req.user.email, key);
    if (!hasAccess) {
      return res.status(403).json({ error: 'No permission for this device' });
    }

    const title = (typeof value2 === 'string') ? value2.trim() : '';
    const timestamp = new Date().toISOString(); 
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; 

    const client = getTableClient(TABLE_NAME_ENTRIES);
    await client.createEntity({
      partitionKey: key,
      rowKey,
      timestamp,
      value1,
      value2: title,
      createdBy: req.user.email
    });

    return res.status(201).json({ ok: true, timestamp });
  } catch (err) {
    console.error('POST /entry error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/entries/:key', authenticateToken, async (req, res) => {
  try {
    const key = req.params.key;
    if (!key) return res.status(400).json({ error: 'key is required' });

    // Step 1: Permission Check (Legacy compatibility included)
    const hasAccess = await checkAndAutoProvision(req.user.email, key);
    if (!hasAccess) {
      return res.status(403).json({ error: 'No permission for this device' });
    }

    const client = getTableClient(TABLE_NAME_ENTRIES);
    const filter = `PartitionKey eq '${key.replace(/'/g, "''")}'`;
    
    const results = [];
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      results.push({
        value1: entity.value1,
        value2: entity.value2,
        timestamp: entity.timestamp
      });
      if (results.length >= 200) break; 
    }

    results.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return res.json(results.slice(0, 10));
  } catch (err) {
    console.error('GET /entries/:key error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`BBS listening on port ${port}`);
});
