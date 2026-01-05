const express = require('express');
const router = express.Router();
const { getTableClient, TABLE_NAME_CONFIG } = require('../services/storage-service');
const { authenticateToken } = require('../middleware/auth');

// GET /config/coordinates
router.get('/coordinates', async (req, res) => {
  try {
    const client = getTableClient(TABLE_NAME_CONFIG);
    const entity = await client.getEntity('global', 'coordinates');
    return res.json(JSON.parse(entity.config));
  } catch (err) {
    return res.json({
      1280: { play: { x: 63, y: 681 }, fullscreen: { x: 1136, y: 678 } },
      1920: { play: { x: 87, y: 1032 }, fullscreen: { x: 1771, y: 1032 } },
      3840: { play: { x: 114, y: 2124 }, fullscreen: { x: 3643, y: 2122 } }
    });
  }
});

// POST /config/coordinates (Admin Only)
router.post('/coordinates', authenticateToken, async (req, res) => {
  if (!req.user.isAdmin) return res.sendStatus(403);
  
  const newConfig = req.body; 
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

// GET /config/metadata
router.get('/metadata', async (req, res) => {
  try {
    const client = getTableClient(TABLE_NAME_CONFIG);
    const entity = await client.getEntity('global', 'metadata');
    return res.json(JSON.parse(entity.config));
  } catch (err) {
    // Default fallback if not found in DB
    return res.json({
      gameGroups: ['K2', 'K2 K3', 'K4'],
      eventTypes: ['Treenipeli', 'Winterliiga', 'Futsal', 'McDonalds liiga']
    });
  }
});

// POST /config/metadata (Admin Only)
router.post('/metadata', authenticateToken, async (req, res) => {
  if (!req.user.isAdmin) return res.sendStatus(403);
  
  const { gameGroups, eventTypes } = req.body;
  if (!Array.isArray(gameGroups) || !Array.isArray(eventTypes)) {
    return res.status(400).json({ error: 'Invalid metadata format' });
  }

  try {
    const client = getTableClient(TABLE_NAME_CONFIG);
    await client.upsertEntity({
      partitionKey: 'global',
      rowKey: 'metadata',
      config: JSON.stringify({ gameGroups, eventTypes })
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Metadata save error:', err);
    return res.status(500).json({ error: 'Failed to save metadata' });
  }
});

module.exports = router;

