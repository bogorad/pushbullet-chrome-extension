# Offscreen Copy Code

Routed notification Copy Code actions through a Manifest V3 offscreen document
instead of attempting clipboard writes from the background service worker. The
extension now declares the `offscreen` permission, packages `offscreen.html`,
and sends code-copy requests to the hidden page for Clipboard API access.

This follows roborev 138's finding that the service worker copy path would fall
back to the detail window in production. Version files were bumped to 1.5.17.
