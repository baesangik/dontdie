# vendor/siwc-local

Local Node.js SDK for **Sign in with ChatGPT**, copied from
[openai/sign-in-with-chatgpt-devkit](https://github.com/openai/sign-in-with-chatgpt-devkit)
`packages/local/src` at commit `f723814abdccec135b519c451fb6e1992ee5e933`.

The package is not published to npm, so dontdie vendors its source.

- License: [Sign-in with ChatGPT DevKit Noncommercial License v1.0](LICENSE) (Copyright 2026 OpenAI).
  This vendored copy is distributed for noncommercial purposes only.
- Runtime dependencies (`jose`, `proper-lockfile`) are installed from npm under their own licenses.

## Changes

Files changed by dontdie carry a `MODIFIED by dontdie` notice at the top:

| File | Change |
|---|---|
| `src/types.ts` | Added optional `reasoningEffort` to `StreamResponseOptions`. |
| `src/responses.ts` | Forwards `reasoningEffort` as `reasoning: { effort }`. |

All other files are unmodified.
