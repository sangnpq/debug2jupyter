import { parentPort } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';

console.log('[WasmWorker] Lifecycle started, locating WebAssembly module...');

// Multi-Path Matrix scanning project directory shapes
const possibleWasmPaths = [
    path.join(__dirname, '../pkg/debug_to_jupyter_rust.js'),       // Standard out/ -> pkg/
    path.join(__dirname, '../../pkg/debug_to_jupyter_rust.js'),    // Nested distribution
    path.join(process.cwd(), 'pkg/debug_to_jupyter_rust.js'),      // Workspace runtime root
    path.join(process.cwd(), 'debug2jupyter/pkg/debug_to_jupyter_rust.js') 
];

let wasmEngine: any = null;
let loadErrors: string[] = [];

for (const targetPath of possibleWasmPaths) {
    if (fs.existsSync(targetPath)) {
        try {
            // Using Node's native require for CommonJS-compiled Wasm glue code
            wasmEngine = require(targetPath);
            console.log(`[WasmWorker] Success: Bound WebAssembly engine at: ${targetPath}`);
            break;
        } catch (err: any) {
            loadErrors.push(`${targetPath} (Found but failed to load: ${err.message})`);
        }
    } else {
        loadErrors.push(`${targetPath} (File not found)`);
    }
}

if (!wasmEngine) {
    const diagnosticReport = `[WasmWorker] 🚨 CRITICAL INITIALIZATION FAILURE: Could not locate compiled Rust bindings.\nChecked paths:\n- ${loadErrors.join('\n- ')}`;
    console.error(diagnosticReport);
    
    if (parentPort) {
        parentPort.postMessage({ id: 0, error: `Wasm binary missing. Rebuild using wasm-pack.` });
    }
    process.exit(1);
}

if (parentPort) {
    parentPort.on('message', async (msg: any) => {
        console.log(`[WasmWorker] received: action=${msg.action}, id=${msg.id}`);
        try {
            if (msg.action === 'rankThreads') {
                let result = wasmEngine.rank_thread_candidates(msg.candidates, msg.workspaceRoot);
                if (result instanceof Promise) result = await result;
                if (typeof result !== 'string') throw new Error(`Expected string, got ${typeof result}`);
                parentPort!.postMessage({ id: msg.id, data: result });

            } else if (msg.action === 'generateNotebook') {
                let result = wasmEngine.generate_jupyter_notebook(msg.varName, msg.pklPath, msg.venvName);
                if (result instanceof Promise) result = await result;
                if (typeof result !== 'string') throw new Error(`Expected string, got ${typeof result}`);
                parentPort!.postMessage({ id: msg.id, data: result });

            } else if (msg.action === 'isVirtualSource') {
                let result = wasmEngine.is_virtual_source_wasm(msg.sourceJson);
                if (result instanceof Promise) result = await result;
                if (typeof result !== 'string') throw new Error(`Expected string, got ${typeof result}`);
                parentPort!.postMessage({ id: msg.id, data: result });

            } else if (msg.action === 'sanitizeSourcePath') {
                let result = wasmEngine.sanitize_source_path_fn(msg.sourcePath, msg.workspaceRoot);
                if (result instanceof Promise) result = await result;
                if (typeof result !== 'string') throw new Error(`Expected string, got ${typeof result}`);
                parentPort!.postMessage({ id: msg.id, data: result });

            } else if (msg.action === 'formatTimestamp') {
                let result = wasmEngine.format_timestamp_fn();
                if (result instanceof Promise) result = await result;
                if (typeof result !== 'string') throw new Error(`Expected string, got ${typeof result}`);
                parentPort!.postMessage({ id: msg.id, data: result });
            }
        } catch (err: any) {
            console.error(`[WasmWorker] error in ${msg.action}: ${err.message}`);
            parentPort!.postMessage({ id: msg.id, error: err.message });
        }
    });
}