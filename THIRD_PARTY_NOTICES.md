# Third-party notices

The handwritten extension code is licensed under the root MIT license.

`src/protocol/` contains generated API types from OpenAI Codex 0.150.1.
The upstream Codex source is licensed under Apache-2.0. Its license and
notice are preserved in `licenses/Codex-APACHE-2.0.txt` and
`licenses/Codex-NOTICE.txt`. The copied upstream notice describes Codex
as a whole; this repository includes only its generated API types.

The runtime installer downloads the official Codex platform package
separately and preserves its vendor tree. This repository does not
redistribute Codex executables, Ollama, or model weights.

The webview bundles `marked` and `dompurify`; esbuild preserves bundled
license comments. Dependency versions are recorded in `package-lock.json`.
