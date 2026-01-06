const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getTableClient, TABLE_NAME_LIBRARY } = require('../services/storage-service');
const { listMusicBlobs, uploadMusicBlob } = require('../services/blob-service');
const { authenticateToken } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// 1. GET /library/:type - Fetch content by type (SONG, VIDEO, IMAGE, VEO)
router.get('/:type', authenticateToken, async (req, res) => {
  try {
    const { type } = req.params;
    const client = getTableClient(TABLE_NAME_LIBRARY);
    const filter = `PartitionKey eq '${type.toUpperCase()}'`;
    
    const results = [];
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      results.push({
        rowKey: entity.rowKey,
        type: entity.partitionKey,
        url: entity.url,
        title: entity.title,
        metadata: entity.metadata ? JSON.parse(entity.metadata) : {},
        creatorId: entity.creatorId,
        creatorEmail: entity.creatorEmail,
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

// 1b. GET /library/blob/music - Fetch content from Azure Blob Storage
router.get('/blob/music', authenticateToken, async (req, res) => {
  try {
    const blobs = await listMusicBlobs();
    return res.json(blobs);
  } catch (err) {
    console.error('GET /library/blob/music error:', err);
    return res.status(500).json({ error: 'Failed to fetch music from blob storage' });
  }
});

// 2b. POST /library/blob/upload - Upload file to Azure Blob Storage
router.post('/blob/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, buffer, mimetype } = req.file;
    await uploadMusicBlob(originalname, buffer, mimetype, req.user.email);

    return res.status(201).json({ ok: true, filename: originalname });
  } catch (err) {
    console.error('POST /library/blob/upload error:', err);
    return res.status(500).json({ error: 'Failed to upload file to blob storage' });
  }
});

// 2. POST /library - Add new content to global library
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { type, url, title, metadata } = req.body;
    
    if (!type || !url || !title) {
      return res.status(400).json({ error: 'type, url, and title are required' });
    }

    const client = getTableClient(TABLE_NAME_LIBRARY);
    const timestamp = new Date().toISOString();
    const rowKey = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await client.createEntity({
      partitionKey: type.toUpperCase(),
      rowKey,
      url,
      title,
      metadata: metadata ? JSON.stringify(metadata) : null,
      creatorId: req.user.systemId,
      creatorEmail: req.user.email,
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

