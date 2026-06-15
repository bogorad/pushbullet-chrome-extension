# PSK Persistence And Code Formats

Changed E2EE password storage back to local Chrome storage so the PSK survives
extension reloads. It remains local-only and is not written to sync storage.

Expanded verification-code detection to preserve grouped codes with a hyphen,
including numeric and alphanumeric forms such as `527-176`, `abc-pqr`, and
`A1c2-P9r8`, while keeping contiguous six-digit code support.

Version files were bumped to 1.5.18.
