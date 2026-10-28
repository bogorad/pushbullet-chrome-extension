import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from '../../src/options/toast';

describe('options toast', () => {
  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('creates a fixed top-right container with aria-live', () => {
    showToast('success', 'Saved');
    const container = document.getElementById('toast-container');
    expect(container).not.toBeNull();
    expect(container?.getAttribute('aria-live')).toBe('polite');
    expect(container?.className).toContain('toast-container');
  });

  it('shows a success toast with accessible role and correct class', () => {
    showToast('success', 'Device nickname updated');
    const toast = document.querySelector('#toast-container .toast');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.className).toContain('toast-success');
    expect(toast?.textContent).toContain('Device nickname updated');
  });

  it('auto-hides success toasts after 3s', async () => {
    vi.useFakeTimers();
    showToast('success', 'Saved');
    expect(document.querySelectorAll('#toast-container .toast')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelectorAll('#toast-container .toast')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('persists error toasts with a close action', async () => {
    vi.useFakeTimers();
    showToast('error', 'Save failed');
    await vi.advanceTimersByTimeAsync(10000);
    const toast = document.querySelector('#toast-container .toast-error');
    expect(toast).not.toBeNull();
    const close = toast?.querySelector('button');
    expect(close).not.toBeNull();
    close?.click();
    expect(document.querySelectorAll('#toast-container .toast')).toHaveLength(0);
    vi.useRealTimers();
  });

  it('caps stacking at 3 toasts, dropping the oldest', () => {
    showToast('success', 'first');
    showToast('success', 'second');
    showToast('success', 'third');
    showToast('success', 'fourth');
    const toasts = document.querySelectorAll('#toast-container .toast');
    expect(toasts).toHaveLength(3);
    expect(document.querySelector('#toast-container')?.textContent).not.toContain('first');
    expect(document.querySelector('#toast-container')?.textContent).toContain('fourth');
  });
});
