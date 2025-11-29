'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const { TableClient } = require('@azure/data-tables');

const app = express();
const port = process.env.PORT || 3000;

// Basic CORS for browser access (adjust origins if needed)
app.use(cors());
app.use(express.json());

// Serve the minimal frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

const tableName = process.env.TABLE_NAME || 'bbsEntries';
const storageConnectionString = process.env.STORAGE_CONNECTION_STRING;

if (!storageConnectionString) {
  // Fail early with a clear message for local/dev misconfigurations
  console.error('Missing STORAGE_CONNECTION_STRING environment variable.');
}

let tableClientSingleton = null;
function getTableClient() {
  if (!tableClientSingleton) {
    tableClientSingleton = TableClient.fromConnectionString(
      storageConnectionString,
      tableName
    );
  }
  return tableClientSingleton;
}

async function ensureTableExists() {
  const client = getTableClient();
  try {
    await client.createTable();
  } catch (err) {
    // createTable throws if already exists. Ignore only that specific case.
    const message = String(err && err.message || err);
    if (!/TableAlreadyExists/i.test(message)) {
      throw err;
    }
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Placeholder for future key whitelist enforcement
function isKeyAllowed(key) {
  // TODO (future): enforce a whitelist, e.g., check key against allowed set
  // return allowedKeys.has(key)
  return true;
}

// POST /entry — writes an entry given key, value1, value2
app.post('/entry', async (req, res) => {
  try {
    const { key, value1, value2 } = req.body || {};

    if (!isNonEmptyString(key) || !isNonEmptyString(value1) || !isNonEmptyString(value2)) {
      return res.status(400).json({ error: 'key, value1, and value2 are required strings' });
    }

    if (!isKeyAllowed(key)) {
      return res.status(403).json({ error: 'Key not allowed' });
    }

    const timestamp = new Date().toISOString(); // UTC timestamp
    const uniqueSuffix = Math.random().toString(36).slice(2, 10);
    const rowKey = `${Date.now()}-${uniqueSuffix}`; // ensure uniqueness and rough ordering

    await ensureTableExists();
    const client = getTableClient();

    await client.createEntity({
      partitionKey: key,
      rowKey,
      timestamp,
      value1,
      value2
    });

    return res.status(201).json({ ok: true, timestamp });
  } catch (err) {
    console.error('POST /entry error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /entries/:key — returns the 10 latest entries for that key
app.get('/entries/:key', async (req, res) => {
  try {
    const key = req.params.key;
    if (!isNonEmptyString(key)) {
      return res.status(400).json({ error: 'key is required' });
    }

    if (!isKeyAllowed(key)) {
      return res.status(403).json({ error: 'Key not allowed' });
    }

    await ensureTableExists();
    const client = getTableClient();

    const filter = `PartitionKey eq '${key.replace(/'/g, "''")}'`;
    const results = [];

    // Collect a limited set, then sort by timestamp desc and take top 10
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      results.push({
        value1: entity.value1,
        value2: entity.value2,
        timestamp: entity.timestamp
      });
      if (results.length >= 200) {
        break; // avoid reading too many; sort will trim to latest 10
      }
    }

    results.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    const latest10 = results.slice(0, 10);

    return res.json(latest10);
  } catch (err) {
    console.error('GET /entries/:key error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`BBS listening on port ${port}`);
});
























