"use strict";
(() => {
  // src/lib/ui/dom.ts
  function getElementById(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id "${id}" not found`);
    }
    return element;
  }
  function querySelector(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element with selector "${selector}" not found`);
    }
    return element;
  }
  function setText(element, text) {
    element.textContent = text;
  }

  // src/notification-detail/index.ts
  var pushData = null;
  function getNotificationId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("id");
  }
  function loadNotification() {
    const notificationId = getNotificationId();
    if (!notificationId) {
      const messageEl = getElementById("message");
      setText(messageEl, "No notification ID provided");
      return;
    }
    chrome.runtime.sendMessage({
      action: "getNotificationData",
      notificationId
    }, (response) => {
      if (response && response.push) {
        pushData = response.push;
        displayNotification(pushData);
      } else {
        const messageEl = getElementById("message");
        setText(messageEl, "Notification not found");
      }
    });
  }
  function displayNotification(push) {
    const titleEl = getElementById("title");
    const messageEl = getElementById("message");
    const typeBadgeEl = getElementById("type-badge");
    const timestampEl = getElementById("timestamp");
    const sourceEl = getElementById("source");
    let title = "Push";
    let message = "";
    let type = push.type || "unknown";
    if (push.type === "note") {
      title = push.title || "Note";
      message = push.body || "";
    } else if (push.type === "link") {
      title = push.title || "Link";
      message = push.url || "";
    } else if (push.type === "file") {
      title = push.file_name || "File";
      message = push.body || push.file_url || "";
    } else if (push.type === "mirror") {
      title = push.title || push.application_name || "Notification";
      message = push.body || "";
    } else if (push.type === "sms_changed") {
      if (push.notifications && push.notifications.length > 0) {
        const sms = push.notifications[0];
        title = sms.title || "SMS";
        message = sms.body || "";
      } else {
        title = "SMS";
        message = "New SMS received";
      }
      type = "sms";
    } else {
      title = "Push";
      message = JSON.stringify(push, null, 2);
    }
    setText(titleEl, title);
    setText(messageEl, message);
    setText(typeBadgeEl, type.toUpperCase());
    if (push.created) {
      const date = new Date(push.created * 1e3);
      setText(timestampEl, date.toLocaleString());
    }
    if (push.source_device_iden) {
      setText(sourceEl, "From device");
    } else {
      setText(sourceEl, "Pushbullet");
    }
    detectVerificationCode(title, message);
  }
  function detectVerificationCode(title, message) {
    const fullText = (title + " " + message).toLowerCase();
    if (!fullText.includes("code")) {
      return;
    }
    const codeMatch = (title + " " + message).match(/\b(\d{6})\b/);
    if (codeMatch) {
      const code = codeMatch[1];
      const actionsDiv = querySelector(".actions");
      const codeBtn = document.createElement("button");
      codeBtn.className = "btn-code";
      codeBtn.innerHTML = `\u{1F4CB} Copy Code: <strong>${code}</strong>`;
      codeBtn.onclick = () => copyCode(code);
      actionsDiv.insertBefore(codeBtn, actionsDiv.firstChild);
    }
  }
  function copyCode(code) {
    navigator.clipboard.writeText(code).then(() => {
      const feedback = getElementById("copy-feedback");
      setText(feedback, `\u2713 Code ${code} copied!`);
      feedback.classList.add("show");
      setTimeout(() => {
        feedback.classList.remove("show");
      }, 2e3);
    }).catch((err) => {
      console.error("Failed to copy code:", err);
      alert("Failed to copy code to clipboard");
    });
  }
  function copyToClipboard() {
    const messageEl = getElementById("message");
    const text = messageEl.textContent || "";
    navigator.clipboard.writeText(text).then(() => {
      const feedback = getElementById("copy-feedback");
      feedback.classList.add("show");
      setTimeout(() => {
        feedback.classList.remove("show");
      }, 2e3);
    }).catch((err) => {
      console.error("Failed to copy:", err);
      alert("Failed to copy to clipboard");
    });
  }
  function closeWindow() {
    window.close();
  }
  function init() {
    const copyBtn = getElementById("copy-btn");
    const closeBtn = getElementById("close-btn");
    copyBtn.addEventListener("click", copyToClipboard);
    closeBtn.addEventListener("click", closeWindow);
    loadNotification();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=notification-detail.js.map
