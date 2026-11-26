const { getConfig } = require('../config');
const userRepo = require('../db/repositories/userRepo');
const { writeAudit } = require('../db/repositories/common');
const {
  hashPassword,
  verifyPassword,
  hashToken,
  generateRandomToken,
  signPayload,
  verifySignedPayload,
  generateTotpSecret,
  verifyTotpCode
} = require('../utils/cryptoUtils');

class AuthError extends Error {
  constructor(message, code = 'UNAUTHORIZED', statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class AuthService {
  getBootstrapStatus() {
    const count = userRepo.countUsers();
    return {
      needsInitialSetup: count === 0,
      userCount: count
    };
  }

  setupInitialAdmin({ username = 'admin', displayName = 'Quản trị viên', password }) {
    if (userRepo.countUsers() > 0) {
      throw new AuthError('Hệ thống đã được thiết lập tài khoản quản trị.', 'ALREADY_INITIALIZED', 409);
    }
    if (!password || String(password).length < 6) {
      throw new AuthError('Mật khẩu quản trị phải có ít nhất 6 ký tự.', 'WEAK_PASSWORD', 400);
    }
    const passwordHash = hashPassword(password);
    const admin = userRepo.createUser({
      username,
      displayName,
      role: 'admin',
      passwordHash
    });
    writeAudit({
      actorUserId: admin.id,
      actorUsername: admin.username,
      actorRole: admin.role,
      action: 'auth.initial_admin_setup',
      resourceType: 'user',
      resourceId: admin.id
    });
    return this.issueSessionForUser(admin, { deviceLabel: 'local-setup', ipAddress: '127.0.0.1' });
  }

  login({ username, password, totpCode = '', deviceLabel = '', ipAddress = '' }) {
    const user = userRepo.findByUsername(username);
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      writeAudit({
        actorUsername: String(username || 'unknown'),
        action: 'auth.login_failed',
        resourceType: 'auth',
        details: { ipAddress }
      });
      throw new AuthError('Sai tên đăng nhập hoặc mật khẩu.', 'INVALID_CREDENTIALS', 401);
    }

    if (user.mfaEnabled && user.mfaSecret) {
      if (!totpCode) {
        return { mfaRequired: true };
      }
      if (!verifyTotpCode(user.mfaSecret, totpCode)) {
        writeAudit({
          actorUserId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          action: 'auth.mfa_failed',
          resourceType: 'auth'
        });
        throw new AuthError('Mã xác thực MFA không đúng hoặc đã hết hạn.', 'INVALID_MFA', 401);
      }
    }

    userRepo.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
    writeAudit({
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      action: 'auth.login_success',
      resourceType: 'user',
      resourceId: user.id,
      details: { ipAddress, deviceLabel }
    });
    return this.issueSessionForUser(user, { deviceLabel, ipAddress });
  }

  issueSessionForUser(user, { deviceLabel = '', ipAddress = '' } = {}) {
    const cfg = getConfig();
    const token = signPayload(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        kind: 'user_session'
      },
      cfg.appSecret,
      cfg.accessTokenTtlSec
    );
    const expiresAt = new Date(Date.now() + cfg.accessTokenTtlSec * 1000).toISOString();
    userRepo.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      deviceLabel,
      ipAddress,
      expiresAt
    });
    return {
      mfaRequired: false,
      accessToken: token,
      expiresAt,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        permissions: user.permissions,
        mfaEnabled: user.mfaEnabled
      }
    };
  }

  verifyAccessToken(token) {
    if (!token) return null;
    const cfg = getConfig();
    const payload = verifySignedPayload(token, cfg.appSecret);
    if (!payload || payload.kind !== 'user_session') return null;
    const session = userRepo.findValidSession(hashToken(token));
    return session;
  }

  verifyDeviceToken(token) {
    if (!token) return null;
    const dev = userRepo.findDeviceByTokenHash(hashToken(token));
    if (!dev) return null;
    userRepo.touchDevice(dev.id, null, 'ONLINE');
    return dev;
  }

  logout(token) {
    if (!token) return;
    userRepo.revokeSession(hashToken(token));
  }

  beginMfaSetup(userId) {
    const user = userRepo.findById(userId);
    if (!user) throw new AuthError('Không tìm thấy người dùng.', 'NOT_FOUND', 404);
    const secret = generateTotpSecret();
    userRepo.updateUser(userId, { mfaSecret: secret, mfaEnabled: false });
    const issuer = 'ToolGuiZaloPro';
    const otpauthUrl = `otpauth://totp/${issuer}:${encodeURIComponent(user.username)}?secret=${secret}&issuer=${issuer}`;
    return { secret, otpauthUrl };
  }

  confirmMfa(userId, code) {
    const user = userRepo.findById(userId);
    if (!user || !user.mfaSecret) {
      throw new AuthError('Chưa khởi tạo MFA.', 'MFA_NOT_INIT', 400);
    }
    if (!verifyTotpCode(user.mfaSecret, code)) {
      throw new AuthError('Mã TOTP không hợp lệ.', 'INVALID_MFA', 400);
    }
    userRepo.updateUser(userId, { mfaEnabled: true });
    writeAudit({
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      action: 'auth.mfa_enabled',
      resourceType: 'user',
      resourceId: user.id
    });
    return { mfaEnabled: true };
  }

  disableMfa(userId) {
    userRepo.updateUser(userId, { mfaEnabled: false, mfaSecret: null });
    return { mfaEnabled: false };
  }

  createUserByAdmin({ username, displayName, role, password, actor }) {
    const passwordHash = hashPassword(password);
    const created = userRepo.createUser({ username, displayName, role, passwordHash });
    writeAudit({
      actorUsername: actor?.username || 'admin',
      actorRole: actor?.role || 'admin',
      action: 'user.created',
      resourceType: 'user',
      resourceId: created.id,
      details: { username: created.username, role: created.role }
    });
    return {
      id: created.id,
      username: created.username,
      displayName: created.displayName,
      role: created.role,
      isActive: created.isActive,
      createdAt: created.createdAt
    };
  }

  enrollDeviceWithPairingCode({ code, deviceName, hostname = '', platform = 'win32', appVersion = '2.0.0' }) {
    const pairing = userRepo.consumePairingCode(code);
    if (!pairing) {
      throw new AuthError('Mã ghép thiết bị không hợp lệ hoặc đã hết hạn.', 'INVALID_PAIRING_CODE', 400);
    }
    const rawDeviceToken = `devtok_${generateRandomToken(32)}`;
    const device = userRepo.registerDevice({
      name: deviceName || hostname || 'Thiết bị kết nối',
      hostname,
      platform,
      role: pairing.role,
      tokenHash: hashToken(rawDeviceToken),
      appVersion
    });
    return { device, deviceToken: rawDeviceToken };
  }
}

module.exports = new AuthService();
module.exports.AuthError = AuthError;
