# Notification Copy Code

Restored the notification-level verification-code action for SMS messages. The
Chrome notification builder now detects six-digit codes in code-related SMS text,
preserves notification buttons through the wrapper, and handles the first
notification button by copying the code when clipboard access is available.

Roborev 137's mixed-precision SMS tickle case was fixed at the same time: raw
timestamp cutoffs are now tied to the same winning second as the normal
correlation timestamp. Version files were bumped to 1.5.16, and the local
ignored `package-lock.json` was refreshed to match that version.
