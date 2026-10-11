import { build } from 'esbuild';
await build({entryPoints:['src/extension.ts'],outfile:'dist/extension.js',bundle:true,platform:'node',format:'cjs',external:['vscode'],sourcemap:true});
await build({entryPoints:['src/webview.ts'],outfile:'dist/webview.js',bundle:true,platform:'browser',format:'iife'});
