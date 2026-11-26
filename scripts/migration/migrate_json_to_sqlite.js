#!/usr/bin/env node
/**
 * Script CLI migration an toàn V1 (database.json) -> V2 (SQLite WAL)
 * Hỗ trợ: --dry-run (kiểm tra trước khi ghi)
 */
const { migrateV1JsonToSqlite } = require('../../src/db/migration');
const db = require('../../src/db/database');

const dryRun = process.argv.includes('--dry-run');
const result = migrateV1JsonToSqlite({ dryRun });
console.log(JSON.stringify(result, null, 2));
db.close();
