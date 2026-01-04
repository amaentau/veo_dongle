const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const IoTHubService = require('../iot-service');
const { DefaultAzureCredential } = require('@azure/identity');
const { getTableClient, TABLE_NAME_DEVICES, TABLE_NAME_PERMISSIONS } = require('../services/storage-service');
const { authenticateToken } = require('../middleware/auth');

const IOT_HUB_NAME = process.env.IOT_HUB_NAME || 'espa-tv-iot-hub';
const IOT_HUB_RESOURCE_GROUP = process.env.IOT_HUB_RESOURCE_GROUP || 'EspaTvResourceGroup';
const IOT_HUB_SUBSCRIPTION_ID = process.env.IOT_HUB_SUBSCRIPTION_ID;
const DEVICE_JWT_SECRET = process.env.DEVICE_JWT_SECRET || 'device-secret-change-in-prod-456';

// Initialize IoT Hub Service
const iotHubService = new IoTHubService(
  IOT_HUB_SUBSCRIPTION_ID,
  IOT_HUB_RESOURCE_GROUP,
  IOT_HUB_NAME,
  new DefaultAzureCredential()
);

(async () => {
  try {
    await iotHubService.initialize();
  } catch (error) {
    console.error('❌ IoT Hub service initialization failed:', error.message);
  }
})();

// Rate limiting storage
const rateLimitStore = new Map();

// --- Helper Functions ---
function generateDeviceToken(deviceId, masterEmail) {
  return jwt.sign(
    {
      deviceId: deviceId,
      masterEmail: masterEmail,
      type: 'device-auth',
      issuedAt: new Date().toISOString()
    },
    DEVICE_JWT_SECRET,
    { expiresIn: '365d' }
  );
}

function verifyDeviceToken(token) {
  try {
    const decoded = jwt.verify(token, DEVICE_JWT_SECRET);
    if (decoded.type !== 'device-auth') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    throw new Error('Invalid device token');
  }
}

function checkRateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const key = `${identifier}`;

  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  const limit = rateLimitStore.get(key);

  if (now > limit.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (limit.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.ceil((limit.resetTime - now) / 1000)
    };
  }

  limit.count++;
  return { allowed: true, remaining: maxRequests - limit.count };
}

function generateDeviceSasToken(resourceUri, signingKey, expiresInMinutes = 60) {
  const encodedUri = encodeURIComponent(resourceUri);
  const expiry = Math.floor(Date.now() / 1000) + (expiresInMinutes * 60);
  const toSign = `${encodedUri}\n${expiry}`;
  const signature = crypto.createHmac('sha256', Buffer.from(signingKey, 'base64'))
    .update(toSign, 'utf8')
    .digest('base64');
  const encodedSignature = encodeURIComponent(signature);
  return `SharedAccessSignature sr=${encodedUri}&sig=${encodedSignature}&se=${expiry}`;
}

function generateIoTHubSasToken(deviceId, primaryKey, hubName, expiresInMinutes = 60) {
  const resourceUri = `${hubName}.azure-devices.net/devices/${deviceId}`;
  return generateDeviceSasToken(resourceUri, primaryKey, expiresInMinutes);
}

async function checkAndAutoProvision(email, deviceId) {
  const permClient = getTableClient(TABLE_NAME_PERMISSIONS);
  const deviceClient = getTableClient(TABLE_NAME_DEVICES);

  try {
    await permClient.getEntity(email, deviceId);
    return true; 
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    if (deviceId === email) {
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

// 1. List my devices
router.get('/', authenticateToken, async (req, res) => {
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

// 2. Claim a device
router.post('/claim', authenticateToken, async (req, res) => {
  try {
    const { deviceId, friendlyName } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    let existingDevice;
    try {
      existingDevice = await deviceClient.getEntity(deviceId, 'metadata');
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    if (existingDevice && existingDevice.masterEmail && existingDevice.masterEmail !== email) {
      return res.status(403).json({ error: 'Device already claimed by another user' });
    }

    await deviceClient.upsertEntity({
      partitionKey: deviceId,
      rowKey: 'metadata',
      friendlyName: friendlyName || deviceId,
      masterEmail: email,
      createdAt: existingDevice ? existingDevice.createdAt : new Date().toISOString()
    });

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

// 3. List shares
router.get('/:deviceId/shares', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can manage shares' });
    }
    
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

// 4. Share device
router.post('/:deviceId/share', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { email: targetEmail } = req.body;
    const email = req.user.email;

    if (!targetEmail || !targetEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can share' });
    }

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
router.delete('/:deviceId/share/:targetEmail', authenticateToken, async (req, res) => {
  try {
    const { deviceId, targetEmail } = req.params;
    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

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

// 6. Release/Delete Device
router.delete('/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can release the device' });
    }

    const iter = permClient.listEntities({ queryOptions: { filter: `RowKey eq '${deviceId.replace(/'/g, "''")}'` } });
    for await (const perm of iter) {
      await permClient.deleteEntity(perm.partitionKey, perm.rowKey);
    }
    await deviceClient.deleteEntity(deviceId, 'metadata');
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /devices error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 7. Update Device Name
router.patch('/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { friendlyName } = req.body;
    const email = req.user.email;

    if (!friendlyName) return res.status(400).json({ error: 'friendlyName required' });

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const device = await deviceClient.getEntity(deviceId, 'metadata');
    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can rename the device' });
    }

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

// 8. IoT Hub Device Registration
router.post('/:deviceId/register-iot', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const device = await deviceClient.getEntity(deviceId, 'metadata');

    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can register IoT Hub devices' });
    }

    console.log(`🔗 Registering device ${deviceId} with IoT Hub for user ${email}`);
    const registrationResult = await iotHubService.registerDevice(deviceId);
    const deviceToken = generateDeviceToken(deviceId, email);

    await deviceClient.updateEntity({
      partitionKey: deviceId,
      rowKey: 'metadata',
      iotHubConnectionString: registrationResult.connectionString,
      iotHubStatus: registrationResult.status,
      iotHubRegisteredAt: new Date().toISOString(),
      deviceAuthToken: deviceToken,
      deviceTokenIssuedAt: new Date().toISOString()
    }, "Merge");

    return res.json({
      ok: true,
      deviceId: deviceId,
      iotHubStatus: registrationResult.status,
      registered: registrationResult.created,
      mock: registrationResult.mock || false
    });
  } catch (err) {
    console.error('POST /devices/:deviceId/register-iot error:', err);
    return res.status(500).json({ error: 'IoT Hub registration failed', details: err.message });
  }
});

// 9. Send IoT Hub Command
router.post('/:deviceId/commands/:command', authenticateToken, async (req, res) => {
  try {
    const { deviceId, command } = req.params;
    const payload = req.body || {};
    const email = req.user.email;

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const device = await deviceClient.getEntity(deviceId, 'metadata');

    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can send commands' });
    }

    const rateLimit = checkRateLimit(`${email}:${deviceId}`, 5, 60000);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Too many commands.',
        retryAfter: rateLimit.resetIn
      });
    }

    const validCommands = ['play', 'pause', 'fullscreen', 'change-track', 'status', 'restart'];
    if (!validCommands.includes(command)) {
      console.warn(`⚠️ Invalid IoT command requested: ${command} for ${deviceId}`);
      return res.status(400).json({ error: 'Invalid command' });
    }

    console.log(`📡 Request to send IoT command: ${command} to ${deviceId} by ${email}`);
    const commandResult = await iotHubService.sendCommandToDevice(deviceId, command, payload);
    
    const isDirectMethod = !!commandResult.methodStatus;
    console.log(`📤 IoT command processed: ${command} to ${deviceId}. Mode: ${isDirectMethod ? 'DirectMethod' : 'C2D'}`);

    return res.json({
      ok: true,
      deviceId: deviceId,
      command: command,
      payload: payload,
      messageId: commandResult.messageId || `direct-${Date.now()}`,
      methodStatus: commandResult.methodStatus,
      methodPayload: commandResult.payload,
      sent: true,
      mode: isDirectMethod ? 'direct' : 'c2d'
    });
  } catch (err) {
    console.error(`❌ POST /devices/${req.params.deviceId}/commands/${req.params.command} error:`, err);
    return res.status(500).json({ 
      error: 'Failed to send IoT command', 
      details: err.message,
      code: err.code || 'UNKNOWN_ERROR'
    });
  }
});

// 11. Get IoT Hub Device Status
router.get('/:deviceId/iot-status', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const email = req.user.email;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const device = await deviceClient.getEntity(deviceId, 'metadata');

    if (device.masterEmail !== email) {
      return res.status(403).json({ error: 'Only the device master can check IoT Hub status' });
    }

    const iotDeviceInfo = await iotHubService.getDevice(deviceId);
    return res.json({
      deviceId: deviceId,
      iotHubStatus: iotDeviceInfo.status,
      connectionState: iotDeviceInfo.connectionState,
      lastActivityTime: iotDeviceInfo.lastActivityTime,
      mock: iotDeviceInfo.mock || false
    });
  } catch (err) {
    console.error('GET /devices/:deviceId/iot-status error:', err);
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: 'Device not registered with IoT Hub' });
    }
    return res.status(500).json({ error: 'Failed to get IoT Hub status', details: err.message });
  }
});

// 10. Get Device Authentication Token
router.get('/:deviceId/auth-token', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const device = await deviceClient.getEntity(deviceId, 'metadata');

    if (device.deviceAuthToken) {
      return res.json({
        deviceToken: device.deviceAuthToken,
        issuedAt: device.deviceTokenIssuedAt,
        masterEmail: device.masterEmail
      });
    } else {
      console.log(`🔄 Generating device token on-demand for ${deviceId}`);
      const deviceToken = generateDeviceToken(deviceId, device.masterEmail);
      await deviceClient.updateEntity({
        partitionKey: deviceId,
        rowKey: 'metadata',
        deviceAuthToken: deviceToken,
        deviceTokenIssuedAt: new Date().toISOString()
      }, "Merge");
      return res.json({
        deviceToken: deviceToken,
        issuedAt: new Date().toISOString(),
        masterEmail: device.masterEmail
      });
    }
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Device not found' });
    console.error('GET /devices/:deviceId/auth-token error:', err);
    return res.status(500).json({ error: 'Failed to retrieve device auth token' });
  }
});

// 12. Get IoT Hub Connection String
router.get('/:deviceId/iot-connection', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { token } = req.query;

    if (!token) return res.status(400).json({ error: 'Device authentication token required' });

    let tokenPayload;
    try {
      tokenPayload = verifyDeviceToken(token);
    } catch (error) {
      return res.status(403).json({ error: 'Invalid device authentication token' });
    }

    if (tokenPayload.deviceId !== deviceId) return res.status(403).json({ error: 'Token not valid for this device' });

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const device = await deviceClient.getEntity(deviceId, 'metadata');

    if (!device.iotHubConnectionString) return res.status(404).json({ error: 'Device not registered with IoT Hub' });

    const connectionString = device.iotHubConnectionString;
    const primaryKeyMatch = connectionString.match(/SharedAccessKey=([^;]+)/);
    if (!primaryKeyMatch) return res.status(500).json({ error: 'Invalid connection string format' });
    
    const primaryKey = primaryKeyMatch[1];
    const sasToken = generateIoTHubSasToken(deviceId, primaryKey, IOT_HUB_NAME, 24 * 60);

    return res.json({
      deviceId: deviceId,
      hubName: IOT_HUB_NAME,
      sasToken: sasToken,
      expiresIn: '24 hours',
      iotHubStatus: device.iotHubStatus,
      registeredAt: device.iotHubRegisteredAt
    });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Device not found or not registered with IoT Hub' });
    console.error('GET /devices/:deviceId/iot-connection error:', err);
    return res.status(500).json({ error: 'Failed to retrieve IoT Hub connection' });
  }
});

// 13. Device Announcement
router.post('/announce', async (req, res) => {
  try {
    const { deviceId, email, friendlyName } = req.body;
    if (!deviceId || !email || !friendlyName) return res.status(400).json({ error: 'Missing fields' });

    const deviceClient = getTableClient(TABLE_NAME_DEVICES);
    const permClient = getTableClient(TABLE_NAME_PERMISSIONS);

    let existingDevice;
    try {
      existingDevice = await deviceClient.getEntity(deviceId, 'metadata');
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    if (existingDevice && existingDevice.masterEmail && existingDevice.masterEmail !== email) {
      console.log(`🔄 Device ${deviceId} changing hands from ${existingDevice.masterEmail} to ${email}`);
      try {
        const iter = permClient.listEntities({ 
          queryOptions: { filter: `RowKey eq '${deviceId.replace(/'/g, "''")}'` } 
        });
        for await (const perm of iter) {
          await permClient.deleteEntity(perm.partitionKey, perm.rowKey);
        }
      } catch (e) {
        console.warn(`⚠️ Failed to fully revoke old permissions for ${deviceId}:`, e.message);
      }
    }

    let finalFriendlyName = friendlyName;
    const isDefaultName = friendlyName.startsWith('ESPA-Pi-') || friendlyName === deviceId;
    const ownerChanged = existingDevice && existingDevice.masterEmail !== email;

    if (existingDevice && !ownerChanged && isDefaultName && existingDevice.friendlyName && !existingDevice.friendlyName.startsWith('ESPA-Pi-')) {
      finalFriendlyName = existingDevice.friendlyName;
    }

    const deviceToken = generateDeviceToken(deviceId, email);

    await deviceClient.upsertEntity({
      partitionKey: deviceId,
      rowKey: 'metadata',
      friendlyName: finalFriendlyName || deviceId,
      masterEmail: email,
      createdAt: existingDevice ? existingDevice.createdAt : new Date().toISOString(),
      lastAnnouncedAt: new Date().toISOString(),
      deviceAuthToken: deviceToken,
      deviceTokenIssuedAt: new Date().toISOString()
    });

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

module.exports = {
  router,
  checkAndAutoProvision
};

