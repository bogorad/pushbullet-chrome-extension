# Project: Unofficial Pushbullet extension for Chrome

## General

- If you think there might not be a correct answer, you say so, instead of guessing.
- If you do not know the answer, say so, instead of guessing.
- Never use the word `likely`, if not sure - confess, instead of guessing.
- Research = good, guesswork = bad.
  Utilize all configured MCP servers servers to the fullest: language-server, repomix, ref and any other, when appropriate.

## Motivation

Pushbullet refuses to publish Manifest-V3 compatible chrome extension, and Chrome deprecated MV2 ages ago.

## Operations

- Maintain (create if needed) the file STATUS.md, put all your detailed plans there as checklists. I has dual use: I monitor progress and in case you fail you can understand the context and continue. Update STATUS.md immediately prior to executing every task.
- Run `npm build` and `npm run test` after successful changes.
- Read, respect and maintain `./docs/adr/`
- After each successful code change, bump the patch version number in manifest.json - e.g., 2.84.6 to 2.84.7, in case there is no patch version, add it - e.g., 2.9 becomes 2.9.1.

## Coding Style:

- Code utilises defensive programming.
- Code fails early.
- Code is documented. Only supply non-trivial comments.
- Code adheres to the DRY principle.
- Code is fully functional.
- Code prioritizes readability over performance.
- Comment each function with a short spec, including argument definitions and call sites.
- Maintain a short spec at the top of each file.
- Always put constant on the left side of comparison
- Use 2 spaces for indentation.
- Convert existing tabs to 2 spaces.
- Use early returns whenever possible to make the code more readable.
