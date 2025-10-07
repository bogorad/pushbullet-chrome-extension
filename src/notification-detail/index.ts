/**
 * Notification detail page
 */

import type { Push } from '../types/domain';
import { MessageAction } from '../types/domain';
import { getElementById, querySelector, setText } from '../lib/ui/dom';

let pushData: Push | null = null;

/**
 * Get notification ID from URL
 */
function getNotificationId(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('id');
}

/**
 * Load notification data from background
 */
function loadNotification(): void {
  const notificationId = getNotificationId();
  
  if (!notificationId) {
    const messageEl = getElementById<HTMLDivElement>('message');
    setText(messageEl, 'No notification ID provided');
    return;
  }

  // Request notification data from background
  chrome.runtime.sendMessage({
    action: MessageAction.GET_NOTIFICATION_DATA,
    notificationId: notificationId
  }, (response: { success: boolean; push?: Push; error?: string }) => {
    if (response && response.push) {
      pushData = response.push;
      displayNotification(pushData);
    } else {
      const messageEl = getElementById<HTMLDivElement>('message');
      setText(messageEl, 'Notification not found');
    }
  });
}

/**
 * Check if URL is from a trusted image domain
 */
function isTrustedImageUrl(urlString: string): boolean {
  if (!urlString) return false;
  
  try {
    const url = new URL(urlString);
        return url.hostname.endsWith('.pushbullet.com') || 
               /^lh[0-9]\.googleusercontent\.com$/.test(url.hostname);  } catch {
    return false;
  }
}

/**
 * Download file from URL
 */
function downloadFile(fileUrl: string, fileName?: string): void {
  // Create a temporary anchor element to trigger download
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = fileName || 'download';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  
  // Trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Show feedback
  const feedback = getElementById<HTMLDivElement>('copy-feedback');
  setText(feedback, '✓ Download started!');
  feedback.classList.add('show');
  setTimeout(() => {
    feedback.classList.remove('show');
  }, 2000);
}

/**
 * Display notification data
 */
function displayNotification(push: Push): void {
  const titleEl = getElementById<HTMLHeadingElement>('title');
  const messageEl = getElementById<HTMLDivElement>('message');
  const typeBadgeEl = getElementById<HTMLSpanElement>('type-badge');
  const timestampEl = getElementById<HTMLSpanElement>('timestamp');
  const sourceEl = getElementById<HTMLSpanElement>('source');
  const fileInfoEl = getElementById<HTMLDivElement>('file-info');
  const fileNameEl = getElementById<HTMLDivElement>('file-name');
  const fileTypeEl = getElementById<HTMLDivElement>('file-type');
  const imagePreviewEl = getElementById<HTMLDivElement>('image-preview');
  const previewImageEl = getElementById<HTMLImageElement>('preview-image');
  const downloadBtn = getElementById<HTMLButtonElement>('download-btn');
  const copyBtn = getElementById<HTMLButtonElement>('copy-btn');

  // Extract title and message based on push type
  let title = 'Push';
  let message = '';
  let type = push.type ?? 'unknown';

  // Hide all optional elements initially
  fileInfoEl.style.display = 'none';
  imagePreviewEl.style.display = 'none';
  downloadBtn.style.display = 'none';

  if (push.type === 'note') {
    title = push.title ?? 'Note';
    message = push.body ?? '';
  } else if (push.type === 'link') {
    title = push.title ?? 'Link';
    message = push.url ?? '';
  } else if (push.type === 'file') {
    const filePush = push as any;
    title = filePush.file_name || 'File';
    message = filePush.body || filePush.file_url || '';
    
    // Show file info
    if (filePush.file_name) {
      setText(fileNameEl, filePush.file_name);
      fileInfoEl.style.display = 'block';
    }
    if (filePush.file_type) {
      setText(fileTypeEl, filePush.file_type);
    }
    
    // Check for image preview
    const imageUrl = filePush.image_url || (filePush.file_type?.startsWith('image/') ? filePush.file_url : null);
    if (imageUrl && isTrustedImageUrl(imageUrl)) {
      previewImageEl.src = imageUrl;
      imagePreviewEl.style.display = 'block';
      
      // Hide copy button for image previews to avoid confusion
      copyBtn.style.display = 'none';
    }
    
    // Show download button if we have a file URL
    if (filePush.file_url) {
      downloadBtn.style.display = 'inline-block';
      downloadBtn.onclick = () => downloadFile(filePush.file_url, filePush.file_name);
    }
  } else if (push.type === 'mirror') {
    title = push.title || push.application_name || 'Notification';
    message = push.body || '';
  } else if ((push as any).type === 'sms_changed') {
    const smsPush = push as any;
    if (smsPush.notifications && smsPush.notifications.length > 0) {
      const sms = smsPush.notifications[0];
      title = sms.title || 'SMS';
      message = sms.body || '';
    } else {
      title = 'SMS';
      message = 'New SMS received';
    }
    type = 'sms' as any;
  } else {
    title = 'Push';
    message = JSON.stringify(push, null, 2);
  }

  setText(titleEl, title ?? 'Push');
  setText(messageEl, message ?? '');
  setText(typeBadgeEl, (type ?? 'unknown').toUpperCase());

  // Set timestamp
  if (push.created) {
    const date = new Date(push.created * 1000);
    setText(timestampEl, date.toLocaleString());
  }

  // Set source
  if (push.source_device_iden) {
    setText(sourceEl, 'From device');
  } else {
    setText(sourceEl, 'Pushbullet');
  }

  // Check for 6-digit verification code
  detectVerificationCode(title, message);
}

/**
 * Detect 6-digit verification code
 */
function detectVerificationCode(title: string, message: string): void {
  const fullText = (title + ' ' + message).toLowerCase();

  // Check if text contains "code" keyword
  if (!fullText.includes('code')) {
    return;
  }

  // Look for 6-digit number
  const codeMatch = (title + ' ' + message).match(/\b(\d{6})\b/);

  if (codeMatch && codeMatch[1]) {
    const code = codeMatch[1];

    // Create code copy button
    const actionsDiv = querySelector<HTMLDivElement>('.actions');
    const codeBtn = document.createElement('button');
    codeBtn.className = 'btn-code';
    codeBtn.innerHTML = `📋 Copy Code: <strong>${code}</strong>`;
    codeBtn.onclick = () => copyCode(code);

    // Insert as first button
    actionsDiv.insertBefore(codeBtn, actionsDiv.firstChild);
  }
}

/**
 * Copy verification code
 */
function copyCode(code: string): void {
  navigator.clipboard.writeText(code).then(() => {
    // Show feedback
    const feedback = getElementById<HTMLDivElement>('copy-feedback');
    setText(feedback, `✓ Code ${code} copied!`);
    feedback.classList.add('show');
    setTimeout(() => {
      feedback.classList.remove('show');
    }, 2000);
  }).catch((err) => {
    console.error('Failed to copy code:', err);
    alert('Failed to copy code to clipboard');
  });
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(): void {
  const messageEl = getElementById<HTMLDivElement>('message');
  const text = messageEl.textContent || '';

  navigator.clipboard.writeText(text).then(() => {
    // Show feedback
    const feedback = getElementById<HTMLDivElement>('copy-feedback');
    feedback.classList.add('show');
    setTimeout(() => {
      feedback.classList.remove('show');
    }, 2000);
  }).catch((err) => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
  });
}

/**
 * Close window
 */
function closeWindow(): void {
  window.close();
}

/**
 * Initialize page
 */
function init(): void {
  // Event listeners
  const copyBtn = getElementById<HTMLButtonElement>('copy-btn');
  const closeBtn = getElementById<HTMLButtonElement>('close-btn');
  
  copyBtn.addEventListener('click', copyToClipboard);
  closeBtn.addEventListener('click', closeWindow);

  // Load notification
  loadNotification();
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

