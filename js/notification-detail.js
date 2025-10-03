// Notification detail page script
(function() {
  'use strict';

  let pushData = null;

  // Get notification ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const notificationId = urlParams.get('id');

  // Load notification data
  function loadNotification() {
    if (!notificationId) {
      document.getElementById('message').textContent = 'No notification ID provided';
      return;
    }

    // Request notification data from background
    chrome.runtime.sendMessage({
      action: 'getNotificationData',
      notificationId: notificationId
    }, (response) => {
      if (response && response.push) {
        pushData = response.push;
        displayNotification(pushData);
      } else {
        document.getElementById('message').textContent = 'Notification not found';
      }
    });
  }

  // Display notification data
  function displayNotification(push) {
    const titleEl = document.getElementById('title');
    const messageEl = document.getElementById('message');
    const typeBadgeEl = document.getElementById('type-badge');
    const timestampEl = document.getElementById('timestamp');
    const sourceEl = document.getElementById('source');

    // Set title
    let title = 'Push';
    let message = '';
    let type = push.type || 'unknown';

    if (push.type === 'note') {
      title = push.title || 'Note';
      message = push.body || '';
    } else if (push.type === 'link') {
      title = push.title || 'Link';
      message = push.url || '';
    } else if (push.type === 'file') {
      title = push.file_name || 'File';
      message = push.body || push.file_url || '';
    } else if (push.type === 'mirror') {
      title = push.title || push.application_name || 'Notification';
      message = push.body || '';
    } else if (push.type === 'sms_changed') {
      if (push.notifications && push.notifications.length > 0) {
        const sms = push.notifications[0];
        title = sms.title || 'SMS';
        message = sms.body || '';
      } else {
        title = 'SMS';
        message = 'New SMS received';
      }
      type = 'sms';
    } else {
      title = 'Push';
      message = JSON.stringify(push, null, 2);
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    typeBadgeEl.textContent = type.toUpperCase();

    // Set timestamp
    if (push.created) {
      const date = new Date(push.created * 1000);
      timestampEl.textContent = date.toLocaleString();
    }

    // Set source
    if (push.source_device_iden) {
      sourceEl.textContent = 'From device';
    } else {
      sourceEl.textContent = 'Pushbullet';
    }

    // Check for 6-digit verification code
    detectVerificationCode(title, message);
  }

  // Detect 6-digit verification code
  function detectVerificationCode(title, message) {
    const fullText = (title + ' ' + message).toLowerCase();

    // Check if text contains "code" keyword
    if (!fullText.includes('code')) {
      return;
    }

    // Look for 6-digit number
    const codeMatch = (title + ' ' + message).match(/\b(\d{6})\b/);

    if (codeMatch) {
      const code = codeMatch[1];

      // Create code copy button
      const actionsDiv = document.querySelector('.actions');
      const codeBtn = document.createElement('button');
      codeBtn.className = 'btn-code';
      codeBtn.innerHTML = `📋 Copy Code: <strong>${code}</strong>`;
      codeBtn.onclick = () => copyCode(code);

      // Insert as first button
      actionsDiv.insertBefore(codeBtn, actionsDiv.firstChild);
    }
  }

  // Copy verification code
  function copyCode(code) {
    navigator.clipboard.writeText(code).then(() => {
      // Show feedback
      const feedback = document.getElementById('copy-feedback');
      feedback.textContent = `✓ Code ${code} copied!`;
      feedback.classList.add('show');
      setTimeout(() => {
        feedback.classList.remove('show');
      }, 2000);
    }).catch((err) => {
      console.error('Failed to copy code:', err);
      alert('Failed to copy code to clipboard');
    });
  }

  // Copy text to clipboard
  function copyToClipboard() {
    const messageEl = document.getElementById('message');
    const text = messageEl.textContent;

    navigator.clipboard.writeText(text).then(() => {
      // Show feedback
      const feedback = document.getElementById('copy-feedback');
      feedback.classList.add('show');
      setTimeout(() => {
        feedback.classList.remove('show');
      }, 2000);
    }).catch((err) => {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    });
  }

  // Close window
  function closeWindow() {
    window.close();
  }

  // Event listeners
  document.getElementById('copy-btn').addEventListener('click', copyToClipboard);
  document.getElementById('close-btn').addEventListener('click', closeWindow);

  // Load notification on page load
  loadNotification();
})();

