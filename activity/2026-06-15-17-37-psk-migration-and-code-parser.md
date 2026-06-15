# PSK migration and code parser

- Kept the end-to-end encryption password canonical in local Chrome storage, while migrating any session-only password left by earlier builds into local storage on first read.
- Centralized verification-code extraction so background notifications and notification-detail windows use the same parser.
- Expanded recognized verification-code tokens to include grouped alphanumeric codes such as `abc-pqr`, `abcd-pqrs`, and mixed alpha/numeric groups.
- Tightened extraction context so unrelated phone-number hyphen chains and hyphenated tokens outside the code clause do not produce copy-code actions.
- Bumped the extension patch version to `1.5.19`.
