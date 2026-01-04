const { TableClient } = require('@azure/data-tables');

const TABLE_NAME_ENTRIES = process.env.TABLE_NAME || 'bbsEntries';
const TABLE_NAME_USERS = 'bbsUsers';
const TABLE_NAME_CONFIG = 'bbsConfig';
const TABLE_NAME_DEVICES = 'bbsDevices';
const TABLE_NAME_PERMISSIONS = 'bbsPermissions';
const STORAGE_CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING;

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

module.exports = {
  getTableClient,
  isFirstUser,
  TABLE_NAME_ENTRIES,
  TABLE_NAME_USERS,
  TABLE_NAME_CONFIG,
  TABLE_NAME_DEVICES,
  TABLE_NAME_PERMISSIONS
};

