export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatError(data, fallback = 'Thao tác thất bại.') {
  if (!data) return fallback;
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error.message === 'string') return data.error.message;
  if (typeof data.message === 'string') return data.message;
  return fallback;
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options
  });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(formatError(data, `HTTP ${res.status}`));
      err.status = res.status;
      err.code = data?.error?.code;
      err.details = data?.error?.details;
      if (res.status === 401 && typeof window.__onUnauthorized === 'function') {
        window.__onUnauthorized();
      }
      throw err;
    }
    return data;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

const activeToastKeys = new Set();

export function showToast({ key = '', title = '', message = '', level = 'success', durationMs = 2600, onClick = null } = {}) {
  if (key && activeToastKeys.has(key)) return;
  if (key) activeToastKeys.add(key);

  let container = document.getElementById('v2ToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'v2ToastContainer';
    container.style.cssText =
      'position:fixed;bottom:14px;right:14px;z-index:99999;display:flex;flex-direction:column;gap:6px;pointer-events:none;max-width:360px;';
    document.body.appendChild(container);
  }

  const bg =
    level === 'danger'
      ? 'linear-gradient(135deg,#b91c1c,#991b1b)'
      : level === 'warning'
      ? 'linear-gradient(135deg,#b45309,#92400e)'
      : 'linear-gradient(135deg,#0f766e,#15803d)';

  const el = document.createElement('div');
  el.style.cssText = `pointer-events:auto;cursor:${onClick ? 'pointer' : 'default'};background:${bg};color:#fff;padding:8px 13px;border-radius:9px;font-size:12.5px;box-shadow:0 4px 14px rgba(0,0,0,0.2);transition:opacity .2s,transform .2s;`;
  el.innerHTML = `<div class="fw-bold">${escapeHtml(title)}</div>${message ? `<div class="opacity-90 small">${escapeHtml(message)}</div>` : ''}`;
  if (onClick) {
    el.addEventListener('click', () => {
      el.remove();
      if (key) activeToastKeys.delete(key);
      onClick();
    });
  }
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => {
      el.remove();
      if (key) activeToastKeys.delete(key);
    }, 200);
  }, durationMs);
}
