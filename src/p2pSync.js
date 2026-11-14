const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const EventEmitter = require('events');
const storage = require('./storage');

const UDP_PORT = 38999;
const SYNC_APP_NAME = 'ToolGuiZalo_P2P';
const HUB_CONFIG_FILE = path.join(__dirname, '..', 'data', 'hub_config.json');

function cleanTopicKey(str) {
  return String(str || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');
}

class P2PSyncEngine extends EventEmitter {
  constructor() {
    super();
    this.hostname = os.hostname();
    this.nodeId = `node_${this.hostname.replace(/\s+/g, '_')}_${Math.random().toString(36).slice(2, 7)}`;
    this.port = Number(process.env.PORT) || 3000;
    this.peers = new Map(); // peerKey -> peerInfo
    this.udpSocket = null;
    this.beaconTimer = null;
    this.localIp = this.detectLocalIp();
    this.publicIp = '';
    this.hubConfig = this.loadHubConfig();
    this.relayStreams = [];
    this.pendingRelayWaiters = new Set();
    this.lastSyncSummary = null;
  }

  loadHubConfig() {
    const defaults = {
      masterHostname: 'LAPTOP-0SNHPCGD',
      masterIp: '58.187.250.105',
      masterLanIp: '192.168.1.153',
      masterPort: 3000,
      roleOverride: null
    };
    try {
      if (fs.existsSync(HUB_CONFIG_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(HUB_CONFIG_FILE, 'utf8'));
        return { ...defaults, ...parsed };
      }
    } catch {}
    return defaults;
  }

  saveHubConfig() {
    try {
      fs.writeFileSync(HUB_CONFIG_FILE, JSON.stringify(this.hubConfig, null, 2), 'utf8');
    } catch {}
  }

  isMasterHub() {
    if (this.hubConfig.roleOverride === 'MASTER') return true;
    if (this.hubConfig.roleOverride === 'CLIENT') return false;
    return (
      this.hostname.toLowerCase() === String(this.hubConfig.masterHostname || '').toLowerCase()
    );
  }

  setMasterHubConfig({ masterIp, masterPort, role }) {
    if (masterIp !== undefined) {
      const cleaned = String(masterIp)
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .trim();
      if (cleaned) {
        const [ipPart, portPart] = cleaned.split(':');
        this.hubConfig.masterIp = ipPart.trim();
        if (portPart && !Number.isNaN(Number(portPart))) {
          this.hubConfig.masterPort = Number(portPart);
        }
      }
    }
    if (masterPort && !Number.isNaN(Number(masterPort))) {
      this.hubConfig.masterPort = Number(masterPort);
    }
    if (role && ['MASTER', 'CLIENT', 'AUTO'].includes(role)) {
      this.hubConfig.roleOverride = role === 'AUTO' ? null : role;
      if (role === 'MASTER') {
        this.hubConfig.masterHostname = this.hostname;
        if (this.publicIp) this.hubConfig.masterIp = this.publicIp;
        this.hubConfig.masterLanIp = this.localIp;
      }
    }
    this.saveHubConfig();
    this.restartRelayStreams();
    if (!this.isMasterHub()) {
      this.sendClientHelloOverRelay().catch(() => {});
    }
    return this.getInfo();
  }

  detectLocalIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async detectPublicIp() {
    try {
      const res = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ip) {
          this.publicIp = data.ip;
          if (this.isMasterHub()) {
            this.hubConfig.masterIp = data.ip;
            this.hubConfig.masterLanIp = this.localIp;
            this.saveHubConfig();
          }
        }
      }
    } catch {}
  }

  start() {
    this.initUdpDiscovery();
    this.startBeaconTimer();
    this.detectPublicIp().then(() => {
      this.restartRelayStreams();
      if (!this.isMasterHub()) {
        this.sendClientHelloOverRelay().catch(() => {});
      }
    });
    setTimeout(() => {
      this.broadcastBeacon();
    }, 1500);
  }

  stop() {
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch {}
      this.udpSocket = null;
    }
    this.stopRelayStreams();
  }

  // ===================== MẠNG NỘI BỘ (UDP DISCOVERY - CHỈ NHẬN DIỆN, KHÔNG TỰ ĐỒNG BỘ NGẦM) =====================

  initUdpDiscovery() {
    try {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.udpSocket.on('error', () => {});

      this.udpSocket.on('message', (msgBuf, rinfo) => {
        try {
          const packet = JSON.parse(msgBuf.toString());
          if (packet.app !== SYNC_APP_NAME) return;
          if (packet.nodeId === this.nodeId) return;

          const peerIp = rinfo.address;
          const peerPort = Number(packet.port) || 3000;
          const peerKey = `${peerIp}:${peerPort}`;
          const isNewPeer = !this.peers.has(peerKey);

          this.peers.set(peerKey, {
            id: packet.nodeId,
            ip: peerIp,
            port: peerPort,
            hostname: packet.hostname || 'Máy trạm',
            role: packet.isMaster ? 'MASTER' : 'CLIENT',
            transport: 'LAN Wi-Fi',
            contactsCount: packet.contactsCount || 0,
            lastSeen: Date.now(),
            lastUpdated: packet.lastUpdated || ''
          });

          if (packet.isMaster && !this.isMasterHub()) {
            this.hubConfig.masterLanIp = peerIp;
            this.hubConfig.masterPort = peerPort;
          }

          if (isNewPeer) {
            this.emit('peer_discovered', this.peers.get(peerKey));
          }
        } catch {}
      });

      this.udpSocket.bind(UDP_PORT, () => {
        try {
          this.udpSocket.setBroadcast(true);
        } catch {}
      });
    } catch {}
  }

  broadcastBeacon() {
    if (!this.udpSocket) return;
    try {
      const payload = Buffer.from(
        JSON.stringify({
          app: SYNC_APP_NAME,
          nodeId: this.nodeId,
          hostname: this.hostname,
          port: this.port,
          isMaster: this.isMasterHub(),
          contactsCount: storage.getContacts().length,
          lastUpdated: storage.getLastUpdated()
        })
      );
      this.udpSocket.send(payload, 0, payload.length, UDP_PORT, '255.255.255.255', () => {});
    } catch {}
  }

  startBeaconTimer() {
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    this.beaconTimer = setInterval(() => {
      this.broadcastBeacon();
      this.cleanStalePeers();
    }, 8000);
  }

  cleanStalePeers() {
    const now = Date.now();
    for (const [key, peer] of this.peers.entries()) {
      const timeout = peer.transport === 'Internet (Khác Wi-Fi)' ? 180000 : 45000;
      if (now - peer.lastSeen > timeout) {
        this.peers.delete(key);
        this.emit('peer_lost', peer);
      }
    }
  }

  // ===================== CẦU NỐI INTERNET XUYÊN WI-FI (THEO IP TRẠM CHÍNH) =====================

  getRelayTopics() {
    const ipKey = cleanTopicKey(this.hubConfig.masterIp || 'default_ip');
    const hostKey = cleanTopicKey(this.hubConfig.masterHostname || 'LAPTOP_0SNHPCGD');
    return {
      // Kênh theo IP Trạm Chính (khi người dùng liên kết theo IP)
      ipInboxTopic: `tgz_hub_in_${ipKey}`,
      ipBroadcastTopic: `tgz_hub_out_${ipKey}`,
      // Kênh cố định theo định danh Máy Trạm Chính của bạn (đảm bảo luôn kết nối được dù đổi Wi-Fi)
      hostInboxTopic: `tgz_hub_in_${hostKey}`,
      hostBroadcastTopic: `tgz_hub_out_${hostKey}`
    };
  }

  stopRelayStreams() {
    for (const req of this.relayStreams) {
      try {
        req.destroy();
      } catch {}
    }
    this.relayStreams = [];
  }

  restartRelayStreams() {
    this.stopRelayStreams();
    const topics = this.getRelayTopics();

    if (this.isMasterHub()) {
      // Máy Trạm Chính của bạn lắng nghe yêu cầu gửi về từ các máy con ở mọi Wi-Fi
      const uniqueInbox = Array.from(new Set([topics.ipInboxTopic, topics.hostInboxTopic]));
      for (const t of uniqueInbox) {
        this.listenNtfyStream(t, (packet) => this.handleMasterRelayInbox(packet));
      }
    } else {
      // Máy Trạm Con lắng nghe Bản Cập Nhật Đầy Đủ từ Máy Trạm Chính phát về
      const uniqueBroadcast = Array.from(
        new Set([topics.ipBroadcastTopic, topics.hostBroadcastTopic])
      );
      for (const t of uniqueBroadcast) {
        this.listenNtfyStream(t, (packet) => this.handleClientRelayBroadcast(packet));
      }
    }
  }

  listenNtfyStream(topic, onPacket) {
    const url = `https://ntfy.sh/${topic}/json`;
    const req = https.get(url, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.event !== 'message') continue;
            this.decodeRelayEvent(evt)
              .then((packet) => {
                if (packet && packet.senderId !== this.nodeId) {
                  onPacket(packet);
                }
              })
              .catch(() => {});
          } catch {}
        }
      });
      res.on('end', () => {
        // Tự kết nối lại nếu ngắt dòng
        setTimeout(() => {
          if (this.relayStreams.includes(req)) {
            this.restartRelayStreams();
          }
        }, 5000);
      });
    });

    req.on('error', () => {});
    this.relayStreams.push(req);
  }

  async decodeRelayEvent(evt) {
    let rawBase64 = evt.message || '';
    if (evt.attachment && evt.attachment.url) {
      const res = await fetch(evt.attachment.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      rawBase64 = await res.text();
    }
    if (!rawBase64 || !rawBase64.startsWith('TGZ1:')) return null;
    const b64 = rawBase64.slice(5);
    const unzipped = zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
    return JSON.parse(unzipped);
  }

  async publishRelayPacket(topic, packet) {
    const jsonStr = JSON.stringify({
      ...packet,
      senderId: this.nodeId,
      senderHost: this.hostname,
      senderIp: this.publicIp || this.localIp,
      sentAt: Date.now()
    });
    const compressedB64 = 'TGZ1:' + zlib.gzipSync(Buffer.from(jsonStr, 'utf8')).toString('base64');

    if (compressedB64.length <= 3500) {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: compressedB64,
        signal: AbortSignal.timeout(8000)
      });
    } else {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: 'PUT',
        headers: { Filename: 'tgz_sync.dat' },
        body: compressedB64,
        signal: AbortSignal.timeout(12000)
      });
    }
  }

  async sendClientHelloOverRelay() {
    const topics = this.getRelayTopics();
    const helloPacket = {
      type: 'CLIENT_HELLO',
      hostname: this.hostname,
      ip: this.publicIp || this.localIp,
      lanIp: this.localIp,
      port: this.port,
      contactsCount: storage.getContacts().length,
      lastUpdated: storage.getLastUpdated()
    };
    await this.publishRelayPacket(topics.ipInboxTopic, helloPacket).catch(() => {});
    if (topics.hostInboxTopic !== topics.ipInboxTopic) {
      await this.publishRelayPacket(topics.hostInboxTopic, helloPacket).catch(() => {});
    }
  }

  /**
   * Xử lý trên MÁY TRẠM CHÍNH (máy của bạn) khi nhận được gói tin từ Máy Con (ở bất kỳ Wi-Fi nào)
   */
  async handleMasterRelayInbox(packet) {
    if (!packet || !packet.type) return;

    const peerKey = `wan_${packet.senderId || packet.senderHost}`;
    const isNewPeer = !this.peers.has(peerKey);
    this.peers.set(peerKey, {
      id: packet.senderId || peerKey,
      ip: packet.senderIp || packet.ip || 'Khác Wi-Fi',
      port: packet.port || 3000,
      hostname: packet.senderHost || packet.hostname || 'Máy trạm từ xa',
      role: 'CLIENT',
      transport: 'Internet (Khác Wi-Fi)',
      contactsCount: packet.state?.contacts?.length || packet.contactsCount || 0,
      lastSeen: Date.now(),
      lastUpdated: packet.state?.lastUpdated || packet.lastUpdated || new Date().toISOString()
    });

    if (isNewPeer) {
      this.emit('peer_discovered', this.peers.get(peerKey));
    }

    if (packet.type === 'CLIENT_PUSH_TO_MASTER' && packet.state) {
      // Bước 2: Máy Chính gộp dữ liệu từ Máy Con và sắp xếp lại thành 1 Bản Cập Nhật Đầy Đủ Nhất
      const mergeRes = storage.mergeRemoteData(packet.state);
      this.lastSyncSummary = {
        at: new Date().toISOString(),
        from: packet.senderHost || packet.senderIp,
        totalContacts: storage.getContacts().length,
        updatedContactsCount: mergeRes.updatedContactsCount,
        newContactsCount: mergeRes.newContactsCount
      };

      this.emit('sync_updated', {
        source: `${packet.senderHost || 'Máy trạm'} (${packet.senderIp || 'Internet'})`,
        ...mergeRes
      });

      // Bước 3: Máy Chính phát Bản Cập Nhật Đầy Đủ Nhất về lại cho tất cả các máy con (cả Internet & LAN)
      await this.broadcastMasterSnapshotToAllClients(packet.reqId);
    }
  }

  /**
   * Xử lý trên MÁY TRẠM CON khi nhận được lệnh hoặc Bản Cập Nhật Đầy Đủ từ Máy Trạm Chính của bạn
   */
  async handleClientRelayBroadcast(packet) {
    if (!packet || !packet.type) return;

    // Ghi nhận trạng thái Máy Trạm Chính trong danh sách kết nối
    const masterKey = `master_${packet.senderHost || this.hubConfig.masterIp}`;
    this.peers.set(masterKey, {
      id: packet.senderId || 'master_hub',
      ip: packet.senderIp || this.hubConfig.masterIp,
      port: this.hubConfig.masterPort || 3000,
      hostname: `${packet.senderHost || this.hubConfig.masterHostname} (Trạm Chính)`,
      role: 'MASTER',
      transport: 'Trạm Trung Chuyển Chính',
      contactsCount: packet.masterState?.contacts?.length || 0,
      lastSeen: Date.now(),
      lastUpdated: packet.masterState?.lastUpdated || new Date().toISOString()
    });

    if (packet.type === 'MASTER_PULL_ALL') {
      // Máy Chính yêu cầu tất cả máy con gửi dữ liệu về để tổng hợp
      const topics = this.getRelayTopics();
      await this.publishRelayPacket(topics.ipInboxTopic, {
        type: 'CLIENT_PUSH_TO_MASTER',
        reqId: packet.reqId || `pull_${Date.now()}`,
        state: this.getLocalExportState()
      }).catch(() => {});
    } else if (packet.type === 'MASTER_FULL_SNAPSHOT' && packet.masterState) {
      // Nhận Bản Cập Nhật Đầy Đủ đã sắp xếp từ Máy Trạm Chính
      const mergeRes = storage.mergeRemoteData(packet.masterState);
      this.lastSyncSummary = {
        at: new Date().toISOString(),
        from: `${packet.senderHost || 'Máy Trạm Chính'}`,
        totalContacts: storage.getContacts().length,
        updatedContactsCount: mergeRes.updatedContactsCount,
        newContactsCount: mergeRes.newContactsCount
      };

      this.emit('sync_updated', {
        source: `Trạm Chính ${packet.senderHost || ''} (${packet.senderIp || this.hubConfig.masterIp})`,
        ...mergeRes
      });

      for (const waiter of this.pendingRelayWaiters) {
        waiter({
          ok: true,
          mode: 'CLIENT_VIA_INTERNET_HUB',
          masterHost: packet.senderHost || this.hubConfig.masterHostname,
          masterIp: packet.senderIp || this.hubConfig.masterIp,
          ...mergeRes
        });
      }
      this.pendingRelayWaiters.clear();
    }
  }

  /**
   * Máy Trạm Chính phát Bản Cập Nhật Đầy Đủ Nhất cho toàn bộ các máy con (cả LAN và khác Wi-Fi)
   */
  async broadcastMasterSnapshotToAllClients(reqId = null) {
    // Đảm bảo dữ liệu trên Máy Chính đã được gộp & sắp xếp chuẩn chỉnh trước khi phát
    storage.state.contacts = storage.sortAndConsolidateContacts(storage.getContacts());
    storage.save();

    const masterState = this.getLocalExportState();
    const topics = this.getRelayTopics();

    // 1. Phát qua kênh Internet Relay cho các máy khác Wi-Fi
    await this.publishRelayPacket(topics.ipBroadcastTopic, {
      type: 'MASTER_FULL_SNAPSHOT',
      reqId,
      masterState
    }).catch(() => {});

    if (topics.hostBroadcastTopic !== topics.ipBroadcastTopic) {
      await this.publishRelayPacket(topics.hostBroadcastTopic, {
        type: 'MASTER_FULL_SNAPSHOT',
        reqId,
        masterState
      }).catch(() => {});
    }

    // 2. Phát trực tiếp qua HTTP cho các máy cùng mạng LAN
    for (const peer of this.peers.values()) {
      if (peer.transport === 'LAN Wi-Fi' && peer.ip) {
        fetch(`http://${peer.ip}:${peer.port || 3000}/api/sync/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(masterState),
          signal: AbortSignal.timeout(4000)
        }).catch(() => {});
      }
    }
  }

  /**
   * Xử lý khi 1 Máy Con gọi trực tiếp HTTP POST /api/sync/hub-exchange tới Máy Chính của bạn
   */
  async handleDirectClientExchange(clientState, clientIp = '') {
    const mergeRes = storage.mergeRemoteData(clientState);

    if (clientState && clientState.nodeId) {
      const peerKey = `${clientIp || clientState.localIp || 'lan'}:${clientState.port || 3000}`;
      this.peers.set(peerKey, {
        id: clientState.nodeId,
        ip: clientIp || clientState.localIp || 'LAN',
        port: clientState.port || 3000,
        hostname: clientState.hostname || 'Máy trạm',
        role: 'CLIENT',
        transport: 'IP Trực Tiếp',
        contactsCount: clientState.contacts?.length || 0,
        lastSeen: Date.now(),
        lastUpdated: new Date().toISOString()
      });
    }

    this.emit('sync_updated', {
      source: `${clientState?.hostname || 'Máy trạm'} (${clientIp || 'IP Trực Tiếp'})`,
      ...mergeRes
    });

    // Phát bản đầy đủ đã tổng hợp cho các máy khác
    this.broadcastMasterSnapshotToAllClients().catch(() => {});

    return {
      ok: true,
      masterHostname: this.hostname,
      masterIp: this.publicIp || this.localIp,
      ...mergeRes,
      masterState: this.getLocalExportState()
    };
  }

  /**
   * KÍCH HOẠT ĐỒNG BỘ KHI BẤM NÚT "⚡ ĐỒNG BỘ NGAY"
   * - Nếu là Máy Con: Gửi toàn bộ dữ liệu về Máy Chính của bạn -> Nhận lại Bản Cập Nhật Đầy Đủ đã sắp xếp từ Máy Chính.
   * - Nếu là Máy Chính của bạn: Thu thập dữ liệu từ tất cả các máy con -> Tổng hợp & sắp xếp thành Bản Cập Nhật Đầy Đủ -> Phát lại cho tất cả các máy con.
   */
  async syncAll() {
    if (this.isMasterHub()) {
      let totalUpdated = 0;
      let totalNew = 0;

      // 1. Thu thập trực tiếp từ các máy trong cùng mạng LAN (nếu có)
      for (const peer of this.peers.values()) {
        if (peer.transport === 'LAN Wi-Fi' && peer.ip) {
          try {
            const res = await fetch(`http://${peer.ip}:${peer.port || 3000}/api/sync/state`, {
              signal: AbortSignal.timeout(3500)
            });
            if (res.ok) {
              const remState = await res.json();
              const mRes = storage.mergeRemoteData(remState);
              totalUpdated += mRes.updatedContactsCount || 0;
              totalNew += mRes.newContactsCount || 0;
            }
          } catch {}
        }
      }

      // 2. Phát lệnh yêu cầu các máy ở khác Wi-Fi gửi dữ liệu về Trạm Chính
      const topics = this.getRelayTopics();
      const reqId = `pull_${Date.now()}`;
      await this.publishRelayPacket(topics.ipBroadcastTopic, {
        type: 'MASTER_PULL_ALL',
        reqId
      }).catch(() => {});
      if (topics.hostBroadcastTopic !== topics.ipBroadcastTopic) {
        await this.publishRelayPacket(topics.hostBroadcastTopic, {
          type: 'MASTER_PULL_ALL',
          reqId
        }).catch(() => {});
      }

      // Chờ 1.5s để các máy con từ xa đẩy dữ liệu về rồi phát Bản Cập Nhật Đầy Đủ Nhất cho toàn mạng
      await new Promise((r) => setTimeout(r, 1500));
      await this.broadcastMasterSnapshotToAllClients(reqId);

      this.emit('sync_updated', {
        source: 'Trạm Trung Chuyển Chính (Đã gộp & phát toàn mạng)',
        changed: true,
        updatedContactsCount: totalUpdated,
        newContactsCount: totalNew,
        totalContacts: storage.getContacts().length
      });

      return {
        ok: true,
        role: 'MASTER',
        peersCount: this.peers.size,
        totalContacts: storage.getContacts().length,
        totalUpdated,
        totalNew,
        message: `Trạm Chính đã gom dữ liệu, sắp xếp thành 1 bản đầy đủ (${storage.getContacts().length} SĐT) và phát về cho tất cả các máy!`
      };
    } else {
      // MÁY CON: Đẩy toàn bộ dữ liệu hiện có về Máy Trạm Chính của bạn và nhận lại Bản Cập Nhật Đầy Đủ
      const localState = this.getLocalExportState();
      const candidateIps = Array.from(
        new Set([this.hubConfig.masterIp, this.hubConfig.masterLanIp].filter(Boolean))
      );

      // 1. Thử kết nối IP trực tiếp tới Máy Chính trước (nhanh 10ms nếu cùng Wi-Fi hoặc VPN / mở Port)
      for (const ip of candidateIps) {
        try {
          const url = `http://${ip}:${this.hubConfig.masterPort || 3000}/api/sync/hub-exchange`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localState),
            signal: AbortSignal.timeout(2500)
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.masterState) {
              const mergeRes = storage.mergeRemoteData(data.masterState);
              this.peers.set(`master_${ip}`, {
                id: 'master_hub',
                ip,
                port: this.hubConfig.masterPort || 3000,
                hostname: `${data.masterHostname || this.hubConfig.masterHostname} (Trạm Chính)`,
                role: 'MASTER',
                transport: 'IP Trực Tiếp',
                contactsCount: data.masterState.contacts?.length || 0,
                lastSeen: Date.now(),
                lastUpdated: data.masterState.lastUpdated || new Date().toISOString()
              });
              this.emit('sync_updated', {
                source: `Trạm Chính (${ip})`,
                ...mergeRes
              });
              return {
                ok: true,
                role: 'CLIENT',
                transport: 'DIRECT_IP',
                masterIp: ip,
                peersCount: this.peers.size,
                totalContacts: storage.getContacts().length,
                totalUpdated: mergeRes.updatedContactsCount,
                totalNew: mergeRes.newContactsCount,
                message: `Đã gửi dữ liệu về Máy Chính (${ip}) và nhận lại bản cập nhật đầy đủ (${storage.getContacts().length} SĐT)!`
              };
            }
          }
        } catch {}
      }

      // 2. Nếu khác mạng Wi-Fi (không thông IP nội bộ): Tự động gửi qua Cầu Nối Internet về Máy Chính của bạn!
      const topics = this.getRelayTopics();
      const reqId = `req_${Date.now()}`;

      const waitPromise = new Promise((resolve) => {
        const waiter = (result) => resolve(result);
        this.pendingRelayWaiters.add(waiter);
        setTimeout(() => {
          this.pendingRelayWaiters.delete(waiter);
          resolve(null);
        }, 7500);
      });

      await this.publishRelayPacket(topics.ipInboxTopic, {
        type: 'CLIENT_PUSH_TO_MASTER',
        reqId,
        state: localState
      }).catch(() => {});

      if (topics.hostInboxTopic !== topics.ipInboxTopic) {
        await this.publishRelayPacket(topics.hostInboxTopic, {
          type: 'CLIENT_PUSH_TO_MASTER',
          reqId,
          state: localState
        }).catch(() => {});
      }

      const relayRes = await waitPromise;
      if (relayRes && relayRes.ok) {
        return {
          ok: true,
          role: 'CLIENT',
          transport: 'INTERNET_RELAY',
          masterIp: this.hubConfig.masterIp,
          peersCount: this.peers.size,
          totalContacts: storage.getContacts().length,
          totalUpdated: relayRes.updatedContactsCount || 0,
          totalNew: relayRes.newContactsCount || 0,
          message: `Đã đồng bộ xuyên Wi-Fi với Máy Trạm Chính (${relayRes.masterHost || this.hubConfig.masterIp})! Tổng số: ${storage.getContacts().length} SĐT.`
        };
      }

      return {
        ok: true,
        role: 'CLIENT',
        transport: 'QUEUED_TO_MASTER',
        masterIp: this.hubConfig.masterIp,
        peersCount: this.peers.size,
        totalContacts: storage.getContacts().length,
        message: `Đã gửi toàn bộ dữ liệu về hàng đợi của Máy Trạm Chính (${this.hubConfig.masterIp}). Ngay khi Máy Chính mở lên sẽ tự động tổng hợp và trả bản đầy đủ về!`
      };
    }
  }

  addManualPeer(ip, port = 3000) {
    this.setMasterHubConfig({ masterIp: ip, masterPort: port });
    return true;
  }

  async notifyAllPeers() {
    // Chế độ làm việc độc lập: Các máy tự làm riêng, CHỈ đồng bộ khi bấm nút "Đồng Bộ Ngay"
    return;
  }

  getLocalExportState() {
    return {
      nodeId: this.nodeId,
      hostname: this.hostname,
      localIp: this.localIp,
      publicIp: this.publicIp,
      port: this.port,
      lastUpdated: storage.getLastUpdated(),
      settingsUpdatedAt: storage.state.settingsUpdatedAt || storage.state.lastUpdated,
      settings: storage.getSettings(),
      contacts: storage.getContacts()
    };
  }

  getInfo() {
    return {
      nodeId: this.nodeId,
      hostname: this.hostname,
      localIp: this.localIp,
      publicIp: this.publicIp || this.hubConfig.masterIp || '',
      port: this.port,
      isMasterHub: this.isMasterHub(),
      role: this.isMasterHub() ? 'MASTER' : 'CLIENT',
      masterHostname: this.hubConfig.masterHostname,
      masterIp: this.hubConfig.masterIp,
      masterLanIp: this.hubConfig.masterLanIp,
      masterPort: this.hubConfig.masterPort || 3000,
      lastUpdated: storage.getLastUpdated(),
      lastSyncSummary: this.lastSyncSummary,
      peersCount: this.peers.size,
      peers: Array.from(this.peers.values())
    };
  }
}

const p2pSync = new P2PSyncEngine();
module.exports = p2pSync;
