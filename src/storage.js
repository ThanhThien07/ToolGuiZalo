/**
 * V2 Storage Facade:
 * Giữ tương thích cho mọi module gọi storage.* cũ trong quá trình chuyển đổi,
 * nhưng mọi thao tác đọc/ghi đều đi thẳng vào SQLite WAL repositories (single source of truth).
 */
const db = require('./db/database');
const contactRepo = require('./db/repositories/contactRepo');
const { accountRepo, settingsRepo } = require('./db/repositories/accountRepo');
const auditRepo = require('./db/repositories/auditRepo');
const { writeAudit } = require('./db/repositories/common');
const { migrateV1JsonToSqlite } = require('./db/migration');
const logger = require('./utils/logger');

class StorageFacade {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    db.getConnection();
    migrateV1JsonToSqlite({ dryRun: false });
    this.initialized = true;
  }

  save() {
    // No-op: SQLite repositories persist atomically in WAL transactions
  }

  getLastUpdated() {
    const row = db.queryOne('SELECT MAX(updated_at) AS ts FROM contacts');
    return (row && row.ts) || new Date().toISOString();
  }

  addLog(level, message, meta = {}) {
    const masked = logger.maskPiiInString(message);
    writeAudit({
      action: `log.${level}`,
      resourceType: 'system',
      details: { message: masked, ...logger.sanitizeMeta(meta) }
    });
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      message: masked
    };
  }

  getLogs(limit = 100) {
    return auditRepo.listAuditLogs({ action: 'log.', limit }).items.map((item) => ({
      id: item.event_uuid,
      timestamp: item.created_at,
      level: item.action.replace('log.', ''),
      message: item.details?.message || item.action
    }));
  }

  getSettings() {
    this.init();
    return settingsRepo.getAppSettings();
  }

  updateSettings(partial) {
    this.init();
    return settingsRepo.updateAppSettings(partial);
  }

  getAccounts() {
    this.init();
    return accountRepo.list();
  }

  getAccount(id) {
    this.init();
    return accountRepo.getById(id);
  }

  getActiveAccount() {
    this.init();
    return accountRepo.getActive();
  }

  setActiveAccount(id) {
    this.init();
    return accountRepo.setActive(id);
  }

  addAccount(name, channel = 'zalo_web') {
    this.init();
    return accountRepo.create({ name, channel });
  }

  updateAccount(id, patch) {
    this.init();
    return accountRepo.update(id, patch);
  }

  incrementAccountSent(id) {
    this.init();
    return accountRepo.incrementSent(id);
  }

  deleteAccount(id) {
    this.init();
    return accountRepo.delete(id);
  }

  getContacts() {
    this.init();
    return contactRepo.getAll();
  }

  getContact(id) {
    this.init();
    return contactRepo.getById(id);
  }

  appendContacts(newContacts, deduplicate = true, options = {}) {
    this.init();
    const res = contactRepo.importBatch(newContacts, { deduplicate, ...options });
    return { contacts: contactRepo.getAll(), addedOrResetCount: res.addedCount + res.updatedCount };
  }

  addContact(contactData) {
    this.init();
    const res = contactRepo.importBatch([contactData], { deduplicate: true });
    return contactRepo.getById(res.importedIds[0]);
  }

  updateContact(id, patch) {
    this.init();
    return contactRepo.updateContact(id, patch);
  }

  clearContacts() {
    this.init();
    return contactRepo.clearAll();
  }

  clearCache() {
    this.init();
    return contactRepo.clearPhoneCache();
  }

  clearPhoneCache() {
    this.init();
    return contactRepo.clearPhoneCache();
  }

  resetContactsStatus(filterStatus = 'ALL') {
    this.init();
    contactRepo.resetStatus(filterStatus);
    return contactRepo.getAll();
  }

  getStats() {
    this.init();
    return contactRepo.getStats();
  }
}

module.exports = new StorageFacade();
