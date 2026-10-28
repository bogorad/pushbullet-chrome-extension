# DIGI PIN discovery

Decision: Add `pin` and Spanish `codigo`/`código` (`c[oó]digo`) to the verification-keyword vocabulary in `src/lib/verification-code.ts`. Keep the existing 48-char same-clause context window and token shapes. No hardcoding of the DIGI template.

Change: `extractVerificationCode` now finds `614612` in the Spanish DIGI SMS where the digits follow `PIN al iniciar sesion:` and a later `PIN`/`codigo` mention has no digits. Added regression tests for the Spanish original, the English translation, and accented `código`/`sesión` wording in `tests/lib/verification-code.test.ts`. Bumped patch version to 1.5.26. Bead: pushbullet-chrome-extension-fxc (left open, not pushed).

Reason: The keyword vocabulary only contained English `code|passcode|otp` forms, so `PIN` never qualified the digits as a verification code.
