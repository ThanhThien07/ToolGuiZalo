const EventEmitter = require('events');

/**
 * Task Engine: Quản lý Hàng đợi tác vụ (Task Queue) và Tập hợp Worker (Worker Pool)
 * Thiết kế theo mô hình Central Task Orchestrator độc lập, tự phục hồi khi Worker gặp lỗi.
 */

class TaskEngine extends EventEmitter {
  constructor() {
    super();
    this.queue = []; // Danh sách các Task: [Task]
    this.workers = new Map(); // workerId -> WorkerState
    this.mode = 'ROUND_ROBIN'; // 'ROUND_ROBIN' (Luân phiên) | 'PARALLEL' (Song song đa luồng)
    this.state = 'IDLE'; // 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED'
    this.rotateEveryN = 15;
  }

  /**
   * Khởi tạo hàng đợi từ danh sách contacts
   */
  initQueue(contacts, options = {}) {
    this.queue = contacts.map((c, idx) => ({
      id: `task_${c.id || idx}_${Date.now()}`,
      contactId: c.id,
      phone: c.phone || c.rawPhone,
      name: c.name || '',
      zaloName: c.zaloName || '',
      customMessage: c.customMessage || '',
      info: c.info || '',
      status: 'QUEUED', // 'QUEUED' | 'ASSIGNED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRY'
      assignedWorkerId: null,
      assignedAt: null,
      completedAt: null,
      attempts: 0,
      maxAttempts: 2,
      result: null,
      error: null
    }));

    this.mode = options.mode || 'ROUND_ROBIN';
    this.rotateEveryN = options.rotateEveryN || 15;
    this.state = 'RUNNING';
    this.emitChange();
    return this.queue;
  }

  /**
   * Đăng ký danh sách Worker (các tài khoản Zalo tham gia chiến dịch)
   */
  registerWorkers(accounts) {
    this.workers.clear();
    for (const acc of accounts) {
      this.workers.set(acc.id, {
        id: acc.id,
        name: acc.name,
        profileDir: acc.profileDir,
        status: 'IDLE', // 'IDLE' | 'RUNNING' | 'RESTING' | 'PAUSED' | 'ERROR' | 'STOPPED'
        currentTaskId: null,
        currentPhone: '',
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        turnCount: 0, // Số tin gửi trong lượt hiện tại (dùng cho luân phiên)
        countdownSec: 0,
        note: '',
        lastError: null
      });
    }
    this.emitChange();
  }

  getWorker(workerId) {
    return this.workers.get(workerId);
  }

  getAllWorkers() {
    return Array.from(this.workers.values());
  }

  /**
   * Bốc Task tiếp theo cho Worker (Atomic Claim - Chống gửi trùng)
   */
  claimTask(workerId) {
    if (this.state !== 'RUNNING') return null;

    const worker = this.workers.get(workerId);
    if (!worker || worker.status === 'PAUSED' || worker.status === 'STOPPED' || worker.status === 'ERROR') {
      return null;
    }

    // Tìm task đầu tiên đang trong trạng thái QUEUED hoặc RETRY
    const task = this.queue.find((t) => t.status === 'QUEUED' || t.status === 'RETRY');
    if (!task) return null;

    task.status = 'RUNNING';
    task.assignedWorkerId = workerId;
    task.assignedAt = new Date().toISOString();
    task.attempts += 1;

    worker.status = 'RUNNING';
    worker.currentTaskId = task.id;
    worker.currentPhone = task.phone;
    worker.note = `Đang gửi SĐT: ${task.phone}`;

    this.emitChange();
    return task;
  }

  /**
   * Đánh dấu Task hoàn thành thành công
   */
  completeTask(taskId, result = {}) {
    const task = this.queue.find((t) => t.id === taskId);
    if (task) {
      task.status = 'SUCCESS';
      task.completedAt = new Date().toISOString();
      task.result = result;

      const worker = this.workers.get(task.assignedWorkerId);
      if (worker) {
        worker.processedCount += 1;
        worker.successCount += 1;
        worker.turnCount += 1;
        worker.currentTaskId = null;
        worker.currentPhone = '';
      }
    }
    this.emitChange();
    this.checkCompletion();
  }

  /**
   * Đánh dấu Task thất bại (có cơ chế Retry tự phục hồi nếu là lỗi tạm thời)
   */
  failTask(taskId, error = '', canRetry = false) {
    const task = this.queue.find((t) => t.id === taskId);
    if (task) {
      task.error = error;

      if (canRetry && task.attempts < task.maxAttempts) {
        task.status = 'RETRY';
        task.assignedWorkerId = null;
      } else {
        task.status = 'FAILED';
        task.completedAt = new Date().toISOString();
      }

      const worker = this.workers.get(task.assignedWorkerId);
      if (worker) {
        worker.processedCount += 1;
        worker.failedCount += 1;
        worker.turnCount += 1;
        worker.currentTaskId = null;
        worker.currentPhone = '';
      }
    }
    this.emitChange();
    this.checkCompletion();
  }

  /**
   * Thu hồi toàn bộ Task của một Worker khi Worker đó gặp sự cố (Tự phục hồi - Self-Healing)
   */
  reclaimWorkerTasks(workerId, reason = 'Worker gặp lỗi') {
    let reclaimed = 0;
    for (const task of this.queue) {
      if (task.assignedWorkerId === workerId && (task.status === 'RUNNING' || task.status === 'ASSIGNED')) {
        task.status = 'QUEUED';
        task.assignedWorkerId = null;
        task.error = `Được thu hồi chuyển nick khác: ${reason}`;
        reclaimed++;
      }
    }

    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = 'ERROR';
      worker.currentTaskId = null;
      worker.currentPhone = '';
      worker.note = reason;
      worker.lastError = reason;
    }

    this.emitChange();
    return reclaimed;
  }

  /**
   * Cập nhật đếm ngược nghỉ ngơi của Worker
   */
  setWorkerCountdown(workerId, seconds, note = 'Đang nghỉ giãn cách an toàn') {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = 'RESTING';
      worker.countdownSec = seconds;
      worker.note = note;
      this.emitChange();
    }
  }

  /**
   * Cập nhật trạng thái một Worker
   */
  updateWorkerStatus(workerId, status, note = '') {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.status = status;
      if (note) worker.note = note;
      this.emitChange();
    }
  }

  /**
   * Kiểm tra xem chiến dịch đã xử lý xong hết chưa
   */
  checkCompletion() {
    const remaining = this.queue.filter((t) => t.status === 'QUEUED' || t.status === 'RETRY' || t.status === 'RUNNING');
    if (remaining.length === 0 && this.queue.length > 0) {
      this.state = 'COMPLETED';
      for (const worker of this.workers.values()) {
        if (worker.status !== 'ERROR' && worker.status !== 'STOPPED') {
          worker.status = 'IDLE';
          worker.note = 'Đã hoàn tất toàn bộ tác vụ';
        }
      }
      this.emit('completed', this.getSummary());
      this.emitChange();
    }
  }

  /**
   * Tạm dừng hoặc tiếp tục toàn bộ hoặc một Worker
   */
  pause() {
    this.state = 'PAUSED';
    for (const w of this.workers.values()) {
      if (w.status === 'RUNNING' || w.status === 'RESTING') {
        w.status = 'PAUSED';
      }
    }
    this.emitChange();
  }

  resume() {
    this.state = 'RUNNING';
    for (const w of this.workers.values()) {
      if (w.status === 'PAUSED') {
        w.status = 'IDLE';
      }
    }
    this.emitChange();
  }

  /**
   * Thống kê tổng hợp tình trạng hàng đợi và các Worker
   */
  getSummary() {
    const total = this.queue.length;
    const queued = this.queue.filter((t) => t.status === 'QUEUED' || t.status === 'RETRY').length;
    const running = this.queue.filter((t) => t.status === 'RUNNING').length;
    const success = this.queue.filter((t) => t.status === 'SUCCESS').length;
    const failed = this.queue.filter((t) => t.status === 'FAILED').length;

    return {
      state: this.state,
      mode: this.mode,
      total,
      queued,
      running,
      success,
      failed,
      workers: this.getAllWorkers()
    };
  }

  emitChange() {
    this.emit('change', this.getSummary());
  }
}

module.exports = new TaskEngine();

