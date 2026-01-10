const express = require('express');
const router = express.Router();
const { getTableClient, TABLE_NAME_SOCIAL } = require('../services/storage-service');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /social/:targetId
 * Fetch all comments and reactions for a content item
 */
router.get('/:targetId', async (req, res) => {
  try {
    const { targetId } = req.params;
    const client = getTableClient(TABLE_NAME_SOCIAL);
    
    const filter = `PartitionKey eq '${targetId.replace(/'/g, "''")}'`;
    const entities = [];
    
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      entities.push(entity);
    }

    const comments = entities
      .filter(e => e.rowKey.startsWith('COMMENT:'))
      .map(e => ({
        id: e.rowKey,
        userId: e.userId,
        username: e.username,
        text: e.text,
        timestamp: e.timestamp
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const reactions = entities
      .filter(e => e.rowKey.startsWith('REACTION:'))
      .reduce((acc, curr) => {
        const type = curr.reactionType || 'like';
        acc[type] = (acc[type] || 0) + 1;
        // Optionally track if current user reacted (would need token)
        return acc;
      }, {});

    return res.json({ comments, reactions });
  } catch (err) {
    console.error('GET /social error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /social/:targetId/comment
 * Add a comment to a content item
 */
router.post('/:targetId/comment', authenticateToken, async (req, res) => {
  try {
    const { targetId } = req.params;
    const { text } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Comment text required' });
    }

    const timestamp = new Date().toISOString();
    const userId = req.user.systemId || req.user.email;
    const rowKey = `COMMENT:${timestamp}:${userId}`;

    const client = getTableClient(TABLE_NAME_SOCIAL);
    await client.createEntity({
      partitionKey: targetId,
      rowKey,
      userId,
      username: req.user.username || 'Anonymous',
      text: text.trim(),
      timestamp
    });

    return res.status(201).json({ ok: true, id: rowKey });
  } catch (err) {
    console.error('POST /social/comment error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /social/:targetId/reaction
 * Toggle a reaction on a content item
 */
router.post('/:targetId/reaction', authenticateToken, async (req, res) => {
  try {
    const { targetId } = req.params;
    const { reactionType = 'like' } = req.body;
    
    const userId = req.user.systemId || req.user.email;
    const rowKey = `REACTION:${userId}`;
    const client = getTableClient(TABLE_NAME_SOCIAL);

    try {
      const existing = await client.getEntity(targetId, rowKey);
      if (existing.reactionType === reactionType) {
        // Toggle off if same type
        await client.deleteEntity(targetId, rowKey);
        return res.json({ ok: true, action: 'removed' });
      } else {
        // Update type
        await client.updateEntity({
          partitionKey: targetId,
          rowKey,
          reactionType,
          username: req.user.username || 'Anonymous',
          timestamp: new Date().toISOString()
        }, "Replace");
        return res.json({ ok: true, action: 'updated' });
      }
    } catch (err) {
      if (err.statusCode === 404) {
        await client.createEntity({
          partitionKey: targetId,
          rowKey,
          userId,
          reactionType,
          username: req.user.username || 'Anonymous',
          timestamp: new Date().toISOString()
        });
        return res.json({ ok: true, action: 'added' });
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /social/reaction error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

