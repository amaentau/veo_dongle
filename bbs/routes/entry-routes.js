const express = require('express');
const router = express.Router();
const { getTableClient, TABLE_NAME_ENTRIES } = require('../services/storage-service');
const { authenticateToken } = require('../middleware/auth');
const { checkAndAutoProvision } = require('./device-routes');

// GET /entries/:key
router.get('/:key', async (req, res) => {
  try {
    const key = req.params.key;
    if (!key) return res.status(400).json({ error: 'key is required' });

    const client = getTableClient(TABLE_NAME_ENTRIES);
    const filter = `PartitionKey eq '${key.replace(/'/g, "''")}'`;
    
    const results = [];
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      results.push({
        rowKey: entity.rowKey,
        value1: entity.value1,
        value2: entity.value2,
        gameGroup: entity.gameGroup,
        eventType: entity.eventType,
        opponent: entity.opponent,
        isHome: entity.isHome,
        scoreHome: entity.scoreHome,
        scoreAway: entity.scoreAway,
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

// POST /entry
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { 
      key, 
      value1, 
      value2, 
      gameGroup, 
      eventType, 
      opponent, 
      isHome, 
      scoreHome, 
      scoreAway 
    } = req.body || {};
    
    if (!key || !value1) return res.status(400).json({ error: 'key and value1 required' });

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
      gameGroup,
      eventType,
      opponent,
      isHome: !!isHome,
      scoreHome: (scoreHome === undefined || scoreHome === null || scoreHome === '') ? null : parseInt(scoreHome),
      scoreAway: (scoreAway === undefined || scoreAway === null || scoreAway === '') ? null : parseInt(scoreAway),
      createdBy: req.user.email
    });

    return res.status(201).json({ ok: true, timestamp, rowKey });
  } catch (err) {
    console.error('POST /entry error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /entry/:partitionKey/:rowKey (Update Score)
router.patch('/:partitionKey/:rowKey', authenticateToken, async (req, res) => {
  try {
    const { partitionKey, rowKey } = req.params;
    const { scoreHome, scoreAway } = req.body;

    const canEdit = req.user.isAdmin || req.user.userGroup === 'Veo Ylläpitäjä';
    if (!canEdit) {
      return res.status(403).json({ error: 'Vain Veo Ylläpitäjä voi muokata tuloksia' });
    }

    const client = getTableClient(TABLE_NAME_ENTRIES);
    const entity = await client.getEntity(partitionKey, rowKey);
    
    await client.updateEntity({
      ...entity,
      scoreHome: (scoreHome === undefined || scoreHome === null || scoreHome === '') ? null : parseInt(scoreHome),
      scoreAway: (scoreAway === undefined || scoreAway === null || scoreAway === '') ? null : parseInt(scoreAway)
    }, "Replace");

    return res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /entry error:', err);
    if (err.statusCode === 404) return res.status(404).json({ error: 'Entry not found' });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

