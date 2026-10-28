/**
 * Options-local toast notifications.
 *
 * Fixed top-right stacked toasts. Success/info auto-hide after 3s;
 * errors persist until dismissed via their close button. Max 3 stacked.
 */

export type ToastType = 'success' | 'error' | 'info';

const TOAST_CONTAINER_ID = 'toast-container';
const MAX_TOASTS = 3;
const AUTO_HIDE_MS = 3000;

/**
 * Return the toast container, creating it when absent.
 */
export function ensureToastContainer(): HTMLElement {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Show a toast notification.
 */
export function showToast(type: ToastType, text: string): void {
  const container = ensureToastContainer();

  while (container.children.length >= MAX_TOASTS) {
    const oldest = container.firstChild;
    if (!oldest) {
      break;
    }
    container.removeChild(oldest);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');

  const message = document.createElement('span');
  message.className = 'toast-message';
  message.textContent = text;
  toast.appendChild(message);

  if (type === 'error') {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '\u00d7';
    close.addEventListener('click', () => {
      toast.remove();
    });
    toast.appendChild(close);
  } else {
    setTimeout(() => {
      toast.remove();
    }, AUTO_HIDE_MS);
  }

  container.appendChild(toast);
}
