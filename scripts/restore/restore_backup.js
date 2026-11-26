#!/usr/bin/env node
/**
 * Script CLI phục hồi bản sao lưu mã hóa ra đường dẫn DB sạch hoặc thay thế DB hiện tại.
 * Ví dụ: node scripts/restore/restore_backup.js <filePath> [targetDbPath]
 */
const db = require('../../src/db/database');
const backupService = require('../../src/services/backupService');

const filePath = process.argv[2];
const targetDbPath = process.argv[3] || null;
if (!filePath) {
  console.error('Cách dùng: node scripts/restore/restore_backup.js <duong_dan_file_backup> [target_db_path]');
  process.exit(1);
}

const res = backupService.restoreBackup({ filePath, targetDbPath, actor: 'cli_restore' });
console.log(JSON.stringify(res, null, 2));
db.close();
