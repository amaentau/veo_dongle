const express = require('express');
const router = express.Router();
const { getTableClient, TABLE_NAME_HUB_PERMISSIONS, TABLE_NAME_CONFIG } = require('../services/storage-service');
const { authenticateToken } = require('../middleware/auth');

/**
 * Middleware to check Hub permissions
 * @param {string[]} allowedRoles 
 */
function checkHubRole(allowedRoles) {
  return async (req, res, next) => {
    try {
      const { hubId } = req.params;
      if (!hubId) return res.status(400).json({ error: 'hubId required' });

      // Admins bypass hub checks
      if (req.user.isAdmin) return next();

      const client = getTableClient(TABLE_NAME_HUB_PERMISSIONS);
      const email = req.user.email;

      try {
        const perm = await client.getEntity(hubId, email);
        if (allowedRoles.includes(perm.role)) {
          req.hubRole = perm.role;
          return next();
        }
        return res.status(403).json({ error: 'Insufficient hub permissions' });
      } catch (err) {
        if (err.statusCode === 404) return res.status(403).json({ error: 'Not a member of this hub' });
        throw err;
      }
    } catch (err) {
      console.error('Hub permission check error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

/**
 * POST /hubs
 * Create a new hub (Community)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Hub name required' });

    const hubId = `hub-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const configClient = getTableClient(TABLE_NAME_CONFIG);
    const permClient = getTableClient(TABLE_NAME_HUB_PERMISSIONS);

    // Create Hub metadata in config table
    await configClient.createEntity({
      partitionKey: 'hubs',
      rowKey: hubId,
      name,
      description: description || '',
      ownerEmail: req.user.email,
      createdAt: new Date().toISOString()
    });

    // Creator becomes MASTER
    await permClient.createEntity({
      partitionKey: hubId,
      rowKey: req.user.email,
      role: 'MASTER',
      username: req.user.username,
      addedAt: new Date().toISOString()
    });

    return res.status(201).json({ ok: true, hubId });
  } catch (err) {
    console.error('POST /hubs error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /hubs
 * List hubs the current user is a member of
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const email = req.user.email;
    const permClient = getTableClient(TABLE_NAME_HUB_PERMISSIONS);
    const configClient = getTableClient(TABLE_NAME_CONFIG);

    // This is a bit inefficient in Table Storage (filtering by RowKey), 
    // in production we might want an inverse index (user-to-hubs).
    // For now, we'll list all entities in hubPermissions and filter by RowKey (email).
    const hubs = [];
    const iter = permClient.listEntities();
    for await (const perm of iter) {
      if (perm.rowKey === email) {
        try {
          const config = await configClient.getEntity('hubs', perm.partitionKey);
          hubs.push({
            id: perm.partitionKey,
            role: perm.role,
            name: config.name,
            description: config.description
          });
        } catch (e) {
          // Hub config might be missing
        }
      }
    }

    return res.json(hubs);
  } catch (err) {
    console.error('GET /hubs error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /hubs/:hubId/members
 * Add or update a member in the hub
 */
router.post('/:hubId/members', authenticateToken, checkHubRole(['MASTER', 'MODERATOR']), async (req, res) => {
  try {
    const { hubId } = req.params;
    const { email, role, username } = req.body;

    if (!email || !role) return res.status(400).json({ error: 'Email and role required' });
    
    const validRoles = ['MASTER', 'MODERATOR', 'PRODUCER', 'VIEWER'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    // Only MASTER can appoint other MASTERs or MODERATORs
    if (req.hubRole !== 'MASTER' && (role === 'MASTER' || role === 'MODERATOR')) {
      return res.status(403).json({ error: 'Only Hub Master can appoint Moderators or Masters' });
    }

    const permClient = getTableClient(TABLE_NAME_HUB_PERMISSIONS);
    await permClient.upsertEntity({
      partitionKey: hubId,
      rowKey: email.toLowerCase(),
      role: role.toUpperCase(),
      username: username || '',
      addedBy: req.user.email,
      addedAt: new Date().toISOString()
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /hubs/members error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = {
  router,
  checkHubRole
};

