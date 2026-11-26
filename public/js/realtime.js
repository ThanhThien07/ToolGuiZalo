import { appState } from './state.js';

const seenEventIds = new Set();
let evtSource = null;

export function connectRealtime(handlers = {}) {
  if (evtSource) {
    try {
      evtSource.close();
    } catch {}
  }

  const qs = appState.lastEventId > 0 ? `?sinceEventId=${appState.lastEventId}` : '';
  evtSource = new EventSource(`/api/v2/events${qs}`);

  const handlePayload = (type, raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload && payload.eventId) {
      if (seenEventIds.has(payload.eventId)) return; // Dedupe event
      seenEventIds.add(payload.eventId);
      if (seenEventIds.size > 500) {
        const first = seenEventIds.values().next().value;
        seenEventIds.delete(first);
      }
      if (payload.eventId > appState.lastEventId) {
        appState.lastEventId = payload.eventId;
      }
    }

    handlers[type]?.(payload);
  };

  for (const evtName of ['snapshot', 'contact.updated', 'task.updated', 'conversation.updated', 'device.status', 'sync.completed', 'system.health']) {
    evtSource.addEventListener(evtName, (e) => handlePayload(evtName, e.data));
  }

  evtSource.onerror = () => {
    // EventSource tự reconnect và gửi sinceEventId/Last-Event-ID
  };
}

export function disconnectRealtime() {
  if (evtSource) {
    try {
      evtSource.close();
    } catch {}
    evtSource = null;
  }
}
