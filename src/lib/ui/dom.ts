/**
 * DOM manipulation utilities for UI pages
 */

/**
 * Safely get an element by ID with type checking
 */
export function getElementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element with id "${id}" not found`);
  }
  return element as T;
}

/**
 * Safely query selector with type checking
 */
export function querySelector<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Element with selector "${selector}" not found`);
  }
  return element as T;
}

/**
 * Show an element
 */
export function show(element: HTMLElement): void {
  element.style.display = '';
}

/**
 * Hide an element
 */
export function hide(element: HTMLElement): void {
  element.style.display = 'none';
}

/**
 * Toggle element visibility
 */
export function toggle(element: HTMLElement): void {
  if (element.style.display === 'none') {
    show(element);
  } else {
    hide(element);
  }
}

/**
 * Set text content safely
 */
export function setText(element: HTMLElement, text: string): void {
  element.textContent = text;
}

/**
 * Set HTML content safely (sanitized)
 */
export function setHTML(element: HTMLElement, html: string): void {
  // Basic sanitization - remove script tags
  const sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  element.innerHTML = sanitized;
}

/**
 * Add event listener with type safety
 */
export function on<K extends keyof HTMLElementEventMap>(
  element: HTMLElement,
  event: K,
  handler: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void
): void {
  element.addEventListener(event, handler);
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Show status message
 */
export function showStatus(element: HTMLElement, message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  element.textContent = message;
  element.className = `status-message status-${type}`;
  show(element);
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    hide(element);
  }, 3000);
}

/**
 * Clear all children of an element
 */
export function clearChildren(element: HTMLElement): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

