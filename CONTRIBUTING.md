# Contributing to Folio

Folio is an early-stage, independently implemented design editor. Read the [README](README.md), [user guide](docs/USAGE.md), and [implementation roadmap](PARITY.md) before proposing a feature. Please open an issue before starting a large change so its scope and compatibility expectations can be discussed.

## Development setup

Use Node.js 22.12 or newer and npm. Windows is the currently verified desktop platform; changes claiming macOS or Linux support should include evidence from that platform.

```sh
git clone https://github.com/priyanshrv-netizen/Folio.git
cd Folio
npm ci
npm run desktop:dev
```

Use your fork's URL if you are contributing through a fork. `npm run dev` starts the browser-only editor. `npm run desktop:dev` starts both Vite and Electron, so stop an existing server on port 5173 before running it.

## Verification

Install Google Chrome before running the tests; both browser-backed Vitest tests and Playwright use its `chrome` channel. WebGL2 is required for shader coverage. Electron end-to-end tests require a desktop environment and functioning operating-system credential protection.

```sh
npm run build
npm test -- --maxWorkers=1
npm run test:e2e
```

Use the serial Vitest command when reporting a full-suite result. A previously observed parallel shader pixel mismatch is recorded in [PARITY.md](PARITY.md#verification-of-the-renderer-guided-pass), and has not been established as fixed. Do not weaken an existing assertion to conceal a failure.

Provider tests use temporary storage, fake credentials, and local servers. You do not need an AWS/R2 account, a Paper account, or a paid image provider to run them. Do not put real credentials in fixtures or attach private documents to bug reports.

## Changes and pull requests

- Keep changes focused, with regression coverage for behavior you change. Preserve validated document data, undo/redo, reopening, and export behavior when editing the model.
- Match the existing TypeScript, React, and Electron conventions. Format touched files using the repository's Prettier configuration rather than reformatting unrelated files.
- Keep the renderer sandboxed and provider secrets in the main process. MCP must remain opt-in and loopback-only, and unsupported imports should fail explicitly rather than execute arbitrary content.
- Update the user guide and roadmap when shipped behavior changes. Describe what was actually verified, including platform, commands, and any limitations.
- Include public-safe screenshots for visual changes. Use original sample content, not private designs or screenshots showing credentials.

Explain the problem, the change, and the checks you ran in your pull request. Never include generated build output, dependency folders, local app data, or extracted proprietary editor code. New contributions must be compatible with the project's MIT license and preserve third-party attribution.

## Commit history

The initial repository history groups an existing local implementation into source, test, and documentation imports. Those commits record publication work at the time it occurred; they do not pretend that earlier development happened as separate historical commits. Future changes should use focused commits with descriptive messages.
