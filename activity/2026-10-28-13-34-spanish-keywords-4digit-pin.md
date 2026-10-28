# Spanish code keywords and 4-digit PINs

Decision: Add `clave` and `contrase[nñ]a` (covers `contraseña`/`contrasena`) to the verification-keyword vocabulary in `src/lib/verification-code.ts`. Add `\d{4}` as a token shape only behind the existing keyword-context check: a bare 4-digit token is accepted only when `hasVerificationContext` finds an accepted keyword in the existing 48-char same-clause window. That context check replaces the protection the 6-digit-only rule gave against years, times, and amounts. No bare generic words (`acceso`, `seguridad`, `inicio`) were added.

Change: Keyword alternation now ends `...|c[oó]digo|clave|contrase[nñ]a`. Token pattern now `...|\d{6}|\d{4}` (6-digit first). Added fixtures in `tests/lib/verification-code.test.ts`: positive `clave`, accented `contraseña`, unaccented `contrasena`, 4-digit PIN (Spanish DIGI-style and English), plus negatives for keyword-with-no-digits, 4-digit year, time, amount, and bare 4-digit prose. Bumped patch version 1.5.26 -> 1.5.27 (single bump for the combined change). Bead: pushbullet-chrome-extension-fxc (left open, not pushed).

Reason: Spanish carrier/bank SMS use `clave`/`contraseña` for one-time codes, and many PINs are 4 digits; both were missed by the English/6-digit-only vocabulary.
