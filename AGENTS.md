# Repository Guidelines

## Project Structure & Module Organization

This repository contains the Ollama Sidebar VS Code extension. `src/extension.ts` coordinates the extension and webview; `runtime.ts` manages Codex and Ollama; `rpc.ts` handles app-server communication; `state.ts` manages chat events. `src/webview.ts` and `media/` implement the interface. `resources/` contains the packaged model catalog, and `scripts/` contains runtime installation tools. Tests live in `test/`. Bundles in `dist/`, packages in `artifacts/`, and `.test-state/` are generated and ignored.

## Build, Test, and Development Commands

Run commands at the repository root with Node.js 22 or newer:

- `npm ci`: install locked dependencies.
- `npm run check`: check strict TypeScript without emitting files.
- `npm test`: run unit tests through `tsx` and Node's test runner.
- `npm run build`: bundle extension and webview with esbuild.
- `npm run test:integration`: launch an isolated VS Code test host.
- `npm run test:live`: exercise the installed runtime and real Ollama model.
- `npm run package`: build a VSIX under `artifacts/`.

Use F5 in VS Code to launch the extension development host. Install Codex with `scripts/install-runtime.ps1`; live tests also require Ollama and the default model.

## Coding Style & Naming Conventions

Use strict TypeScript, camelCase functions and variables, PascalCase types, and the surrounding formatting. Handwritten source generally uses two spaces, single quotes, and semicolons. There is no formatter or lint script. Avoid unrelated formatting changes. Keep `selfAgent.*` settings and command identifiers compatible. Do not hand-edit generated `src/protocol/` types; runtime upgrades require regeneration and integration validation.

## Testing Guidelines

Name unit tests `test/*.test.ts`, using `node:test` and `node:assert/strict`. Cover changed behavior and failure handling rather than implementation details. Run type checks and unit tests for code changes, integration tests for UI/lifecycle changes, and live tests for runtime changes. No coverage threshold is configured. Report unavailable prerequisites explicitly.

## Commit & Pull Request Guidelines

Use focused, imperative subjects such as `Fix chat restoration after reconnect`. PRs should explain behavior changes, link relevant issues, list validation and prerequisites, and include screenshots for visible changes.

## Security & Configuration

Preserve loopback-only Ollama connections, workspace trust, and approval checks. Never commit runtime binaries, model weights, credentials, conversation data, logs, or generated packages. Preserve upstream license notices and follow `.gitignore`.
