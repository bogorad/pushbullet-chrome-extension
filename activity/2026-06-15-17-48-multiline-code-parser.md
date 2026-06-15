# Multiline code parser hardening

- Kept newline as a general verification-code context boundary to avoid matching unrelated tokens on later lines.
- Added direct multiline handling for common layouts where the code phrase and token are adjacent across one line break.
- Added regression coverage for both multiline OTP layouts and newline-separated non-code tokens.
