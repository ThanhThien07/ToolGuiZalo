const dgram = require('dgram');
const os = require('os');
const EventEmitter = require('events');
const storage = require('./storage');

const UDP_PORT = 38999;
const SYNC_APP_NAME = 'ToolGuiZalo_P2P';

class P2PSyncEngine extends EventEmitter {
  constructor() {
    super();
    this.nodeId = `node_${os.hostname().replace(/\s+/g, '_')}_${Math.random().toString(36).slice(2, 8)}`;
    this.hostname = os.hostname();
    this.port = Number(process.env.PORT) || 3000;
    this.peers = new Map(); // peerKey (ip:port) -> peerInfo
    this.udpSocket = null;
    this.beaconTimer = null;
    this.isSyncing = false;
    this.localIp = this.detectLocalIp();
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

  start() {
    this.initUdpDiscovery();
    this.startBeaconTimer();
    // Chờ 2s rồi quét thử mạng LAN nếu cần
    setTimeout(() => {
      this.broadcastBeacon();
    }, 2000);
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
  }

  initUdpDiscovery() {
    try {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.udpSocket.on('error', (err) => {
        // Nếu cổng UDP bị ứng dụng khác chiếm hoặc firewall chặn, ngầm bỏ qua
      });

      this.udpSocket.on('message', async (msgBuf, rinfo) => {
        try {
          const packet = JSON.parse(msgBuf.toString());
          if (packet.app !== SYNC_APP_NAME) return;
          if (packet.nodeId === this.nodeId) return; // Bỏ qua gói tin của chính mình

          const peerIp = rinfo.address;
          const peerPort = Number(packet.port) || 3000;
          const peerKey = `${peerIp}:${peerPort}`;

          const isNewPeer = !this.peers.has(peerKey);
          const prevPeer = this.peers.get(peerKey);

          this.peers.set(peerKey, {
            id: packet.nodeId,
            ip: peerIp,
            port: peerPort,
            hostname: packet.hostname || 'Máy đồng nghiệp',
            lastSeen: Date.now(),
            lastUpdated: packet.lastUpdated || ''
          });

          if (isNewPeer) {
            this.emit('peer_discovered', this.peers.get(peerKey));
            // Ngay khi phát hiện máy mới, tự động trao đổi đồng bộ hai chiều
            this.syncWithPeer(peerIp, peerPort).catch(() => {});
          } else if (prevPeer && prevPeer.lastUpdated !== packet.lastUpdated) {
            // Máy kia vừa có bản cập nhật mới -> đồng bộ ngay
            this.syncWithPeer(peerIp, peerPort).catch(() => {});
          }
        } catch {}
      });

      this.udpSocket.bind(UDP_PORT, () => {
        try {
          this.udpSocket.setBroadcast(true);
        } catch {}
      });
    } catch (e) {
      // quiet fallback
    }
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
          lastUpdated: storage.getLastUpdated()
        })
      );
      this.udpSocket.send(payload, 0, payload.length, UDP_PORT, '255.255.255.255', () => {});
    } catch {}
  }

  startBeaconTimer() {
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    // Phát tín hiệu nhận diện mỗi 6 giây
    this.beaconTimer = setInterval(() => {
      this.broadcastBeacon();
      this.cleanStalePeers();
    }, 6000);
  }

  cleanStalePeers() {
    const now = Date.now();
    for (const [key, peer] of this.peers.entries()) {
      // Nếu quá 35s không thấy phản hồi từ máy kia -> loại khỏi danh sách đang kết nối
      if (now - peer.lastSeen > 35000) {
        this.peers.delete(key);
        this.emit('peer_lost', peer);
      }
    }
  }

  /**
   * Đồng bộ 2 chiều với 1 máy cụ thể:
   * 1. Kéo dữ liệu từ máy bạn về
   * 2. Hợp nhất thông minh theo mốc thời gian (Last-Write-Wins)
   * 3. Nếu máy mình có dữ liệu mới hơn, đẩy trả lại cho máy bạn
   */
  async syncWithPeer(ip, port) {
    const url = `http://${ip}:${port}`;
    try {
      const res = await fetch(`${url}/api/sync/state`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return { ok: false };
      const remoteState = await res.json();

      // Hợp nhất dữ liệu
      const mergeRes = storage.mergeRemoteData(remoteState);

      if (mergeRes.changed) {
        this.emit('sync_updated', {
          source: `${ip}:${port}`,
          ...mergeRes
        });
      }

      // Đẩy bản mới nhất của mình sang cho máy bạn nếu máy mình có dữ liệu cập nhật
      const localState = this.getLocalExportState();
      await fetch(`${url}/api/sync/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localState),
        signal: AbortSignal.timeout(4000)
      }).catch(() => {});

      return { ok: true, ...mergeRes };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Đẩy dữ liệu mới của máy này tới tất cả các máy đang kết nối trong mạng
   */
  async notifyAllPeers() {
    const localState = this.getLocalExportState();
    const peerList = Array.from(this.peers.values());
    if (peerList.length === 0) return;

    for (const peer of peerList) {
      fetch(`http://${peer.ip}:${peer.port}/api/sync/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localState),
        signal: AbortSignal.timeout(3000)
      }).catch(() => {});
    }
  }

  /**
   * Đồng bộ hóa toàn diện với tất cả các máy
   */
  async syncAll() {
    let totalUpdated = 0;
    let totalNew = 0;
    const peerList = Array.from(this.peers.values());
    for (const peer of peerList) {
      const res = await this.syncWithPeer(peer.ip, peer.port);
      if (res && res.ok) {
        totalUpdated += res.updatedContactsCount || 0;
        totalNew += res.newContactsCount || 0;
      }
    }
    return {
      ok: true,
      peersCount: peerList.length,
      totalUpdated,
      totalNew
    };
  }

  addManualPeer(ip, port = 3000) {
    const cleanIp = ip.replace(/^http:\/\//, '').replace(/\/.*$/, '').split(':')[0].trim();
    if (!cleanIp) return false;
    const peerKey = `${cleanIp}:${port}`;
    this.peers.set(peerKey, {
      id: `manual_${cleanIp}`,
      ip: cleanIp,
      port: Number(port) || 3000,
      hostname: `Máy ${cleanIp}`,
      lastSeen: Date.now(),
      lastUpdated: ''
    });
    this.syncWithPeer(cleanIp, port).catch(() => {});
    return true;
  }

  getLocalExportState() {
    return {
      nodeId: this.nodeId,
      hostname: this.hostname,
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
      port: this.port,
      lastUpdated: storage.getLastUpdated(),
      peersCount: this.peers.size,
      peers: Array.from(this.peers.values())
    };
  }
}

const p2pSync = new P2PSyncEngine();
module.exports = p2pSync;
