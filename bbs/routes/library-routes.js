const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getTableClient, TABLE_NAME_LIBRARY } = require('../services/storage-service');
const { listBlobs, uploadBlob } = require('../services/blob-service');
const { authenticateToken } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// 1. GET /library/:type - Fetch content by type (SONG, VIDEO, IMAGE, VEO)
router.get('/:type', authenticateToken, async (req, res) => {
  try {
    const { type } = req.params;
    const { hubId } = req.query;
    const client = getTableClient(TABLE_NAME_LIBRARY);
    let filter = `PartitionKey eq '${type.toUpperCase()}'`;
    
    const results = [];
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      const metadata = entity.metadata ? JSON.parse(entity.metadata) : {};
      
      // Client-side filtering for hubId in metadata if provided
      if (hubId && metadata.hubId !== hubId) continue;

      results.push({
        rowKey: entity.rowKey,
        type: entity.partitionKey,
        url: entity.url,
        title: entity.title,
        metadata,
        creatorId: entity.creatorId,
        creatorEmail: entity.creatorEmail,
        username: entity.username,
        timestamp: entity.timestamp
      });
    }

    results.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return res.json(results);
  } catch (err) {
    console.error('GET /library/:type error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 1b. GET /library/blob/:type - Fetch content from Azure Blob Storage (music or video)
router.get('/blob/:type', authenticateToken, async (req, res) => {
  try {
    const { type } = req.params;
    const blobs = await listBlobs(type);
    return res.json(blobs);
  } catch (err) {
    console.error('GET /library/blob/:type error:', err);
    return res.status(500).json({ error: 'Failed to fetch blobs from storage' });
  }
});

// 2b. POST /library/blob/upload/:type - Upload file to Azure Blob Storage
router.post('/blob/upload/:type', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { type } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, buffer, mimetype } = req.file;
    await uploadBlob(originalname, buffer, mimetype, req.user.email, type);

    return res.status(201).json({ ok: true, filename: originalname });
  } catch (err) {
    console.error('POST /library/blob/upload error:', err);
    return res.status(500).json({ error: 'Failed to upload file to blob storage' });
  }
});

// 2. POST /library - Add new content to global library
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { type, url, title, metadata, tags, hubId } = req.body;
    
    if (!type || !url || !title) {
      return res.status(400).json({ error: 'type, url, and title are required' });
    }

    const client = getTableClient(TABLE_NAME_LIBRARY);
    const timestamp = new Date().toISOString();
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Enrichment: Handle tags and hubId
    const finalMetadata = {
      ...(metadata || {}),
      tags: Array.isArray(tags) ? tags : [],
      hubId: hubId || 'global'
    };

    await client.createEntity({
      partitionKey: type.toUpperCase(),
      rowKey,
      url,
      title,
      metadata: JSON.stringify(finalMetadata),
      creatorId: req.user.systemId,
      creatorEmail: req.user.email,
      username: req.user.username,
      timestamp
    });

    return res.status(201).json({ ok: true, rowKey, type });
  } catch (err) {
    console.error('POST /library error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. DELETE /library/:type/:rowKey - Remove content (Admin or Creator)
router.delete('/:type/:rowKey', authenticateToken, async (req, res) => {
  try {
    const { type, rowKey } = req.params;
    const client = getTableClient(TABLE_NAME_LIBRARY);
    
    const entity = await client.getEntity(type.toUpperCase(), rowKey);
    
    const isCreator = entity.creatorEmail === req.user.email;
    if (!req.user.isAdmin && !isCreator) {
      return res.status(403).json({ error: 'No permission to delete this content' });
    }

    await client.deleteEntity(type.toUpperCase(), rowKey);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /library error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;

