#!/usr/bin/env node
/**
 * Script CLI tạo bản sao lưu mã hóa AES-256-GCM
 */
const db = require('../../src/db/database');
const backupService = require('../../src/services/backupService');

const kindArg = process.argv[2] || 'manual';
db.getConnection();
const result = backupService.createBackup({ kind: kindArg, actor: 'cli' });
console.log(JSON.stringify(result, null, 2));
db.close();
