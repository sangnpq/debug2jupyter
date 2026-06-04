# Detailed Design Specification: Debug to Jupyter (D2J)

## 1. Concurrency & Isolation Architecture

To guarantee highly responsive, lock-free performance across complex multi-process and multi-threaded debugging applications (e.g., distributed web servers or parallel processing loops), variable collection and ranking are entirely decoupled from the single-threaded VS Code Extension Host UI thread.

```Markdown
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               VS Code Extension Host                                   │
│  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────────────────┐  │
│  │   extension.ts   │─────▶│   commands.ts    │─────▶│        wasmBridge.ts         │  │
│  └──────────────────┘      └────────┬─────────┘      └──────────────┬───────────────┘  │
│                                     │                               │                  │
│                              Concurrent Fetch                       Spawns Background  │
│                              (Promise.all)                          Worker Instance    │
│                                     │                               │                  │
│                              ┌──────▼───────┐                       │                  │
│                              │ dapClient.ts │                       ▼                  │
│                              └──────┬───────┘        ┌──────────────────────────────┐  │
│                                     │                │   wasmWorker.js (Worker)     │  │
│                                     │                │ ┌──────────────────────────┐ │  │
│                                     │                │ │  pkg/debug_to_jupyter    │ │  │
│                                     │                │ │  _rust.wasm (Compiled)   │ │  │
│                                     │                │ └────────────┬─────────────┘ │  │
│                                     │                └──────────────┼───────────────┘  │
│                                     │                               │                  │
│                                     └───────────────────────────────┘                  │
│                                            Vectorized Parallel Processing              │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ notebookWriter.ts   /   pythonEnv.ts  /   utils.ts  /  errors.ts  /   logger.ts  │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Closure-Safe Python Serialization Mechanism

When extracting live objects from an active execution stack, standard serialization utilities like `pickle.dump` fail completely with a `PicklingError` if they encounter unpicklable closures, local frames, or dynamically bounded lambdas (e.g., `<locals>.<lambda>`).

To resolve this issue, D2J uses `cloudpickle` which natively handles closures, lambdas, and other dynamically created functions without requiring custom pickler classes.

### Injected Safe-Serialization Payload

```python
import cloudpickle

def d2j_serialize_variable(target_var, output_path):
    try:
        with open(output_path, 'wb') as f:
            cloudpickle.dump(target_var, f)
        print("D2J_SUCCESS")
    except Exception as e:
        # Final safety net: fall back to a string representation if hard failures occur
        with open(output_path, 'wb') as f:
            cloudpickle.dump(f"<D2J_SERIALIZATION_FAILURE: {str(e)}>", f)
        print("D2J_FALLBACK")

# Injected execution call hook
d2j_serialize_variable({EVAL_NAME}, '{OUTPUT_PATH}')
```
---

## 3. Rust Wasm Module (cargo/src/lib.rs)
The WebAssembly layer operates as a synchronous, zero-dependency, vectorized calculation engine. Functions must be compiled as synchronous (pub fn instead of pub async fn) to prevent wasm-bindgen from wrapping the returned strings inside native JavaScript Promises.
Exposed Interfaces
| Function | Signature | Purpose |
| generate_jupyter_notebook | (var_name: String, pkl_path: String, venv_name: String) -> String | Compiles a valid nbformat 4.5 JSON layout mapping the local pickle file loader. |
| rank_thread_candidates | (candidates_json: String, workspace_root: String) -> String | Computes contextual ratings for collected process maps using vectorized scoring rules. |
| is_virtual_source_wasm | (source_json: String) -> String | Parses internal metadata maps to identify virtual evaluation blocks (<string>).

---

## 4. Multi-Threaded Background Processing Layer
### `src/wasmBridge.ts`
Instead of importing compiled WebAssembly artifacts into the main extension execution timeline (which degrades UI frame rates), the bridge delegates computational requests directly down to an isolated long-running background Node.js Worker Thread. It relies on an incremental transaction counter to prevent multi-message collisions.

```TypeScript
import { Worker } from 'worker_threads';
import * as path from 'path';

export class WasmBridge {
    private worker: Worker | null = null;
    private messageCounter = 0;

    public async initialize(extensionPath: string): Promise<void> {
        const workerPath = path.join(extensionPath, 'out', 'wasmWorker.js');
        this.worker = new Worker(workerPath);
    }

    public rankThreadCandidates(candidates: any[], workspaceRoot: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            if (!this.worker) return reject(new Error("Wasm Worker uninitialized"));
            
            const messageId = ++this.messageCounter;
            const handleMessage = (msg: any) => {
                if (msg.id === messageId) {
                    this.worker?.off('message', handleMessage);
                    if (msg.error) reject(new Error(msg.error));
                    else resolve(JSON.parse(msg.data));
                }
            };
            
            this.worker.on('message', handleMessage);
            this.worker.postMessage({
                id: messageId,
                action: 'rankThreads',
                candidates: JSON.stringify(candidates),
                workspaceRoot
            });
        });
    }

    public generateNotebook(varName: string, pklPath: string, venvName: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.worker) return reject(new Error("Wasm Worker uninitialized"));
            
            const messageId = ++this.messageCounter;
            const handleMessage = (msg: any) => {
                if (msg.id === messageId) {
                    this.worker?.off('message', handleMessage);
                    if (msg.error) reject(new Error(msg.error));
                    else resolve(msg.data);
                }
            };
            
            this.worker.on('message', handleMessage);
            this.worker.postMessage({
                id: messageId,
                action: 'generateNotebook',
                varName,
                pklPath,
                venvName
            });
        });
    }
}
```

### `src/wasmWorker.js`
Runs non-blockingly within a background execution context. It implements defensive asynchronous unwrapping (instanceof Promise) and type assertions to catch and await unresolved macro promises generated during delayed runtime initializations. This completely blocks raw "[object Promise]" outputs from entering the serialization channel.

```TypeScript
const { parentPort } = require('worker_threads');
const wasmEngine = require('../pkg/debug_to_jupyter_rust.js');

parentPort.on('message', async (msg) => {
    try {
        if (msg.action === 'rankThreads') {
            let result = wasmEngine.rank_thread_candidates(msg.candidates, msg.workspaceRoot);
            
            // Defensively resolve result if wrapped inside a Promise hook
            if (result instanceof Promise) {
                result = await result;
            }

            if (typeof result !== 'string') {
                throw new Error(`Expected string output from Wasm, but received type: ${typeof result}`);
            }

            parentPort.postMessage({ id: msg.id, data: result });

        } else if (msg.action === 'generateNotebook') {
            let result = wasmEngine.generate_jupyter_notebook(msg.varName, msg.pklPath, msg.venvName);
            
            if (result instanceof Promise) {
                result = await result;
            }

            if (typeof result !== 'string') {
                throw new Error(`Expected string output from Wasm, but received type: ${typeof result}`);
            }

            parentPort.postMessage({ id: msg.id, data: result });
        }
    } catch (err) {
        parentPort.postMessage({ id: msg.id, error: err.message });
    }
});
```

---

## 5. Concurrent Subprocess Multiplexing
### `src/dapClient.ts`
Queries metadata tracks concurrently across all available sibling debug targets and sub-execution environments using Promise.all sweeps. This eliminates cumulative loop latency.

```TypeScript
import * as vscode from 'vscode';
import { WasmBridge } from './wasmBridge';

export async function resolveCurrentFrameId(
    activeSession: vscode.DebugSession,
    variableName: string,
    workspaceRoot: string,
    wasmBridge: WasmBridge
): Promise<any> {
    // 1. Gather all active sibling debug targets (multi-target / subprocess attachments)
    const sessions = [activeSession];
    
    // 2. Query thread pools concurrently across all identified active sessions
    const sessionThreads = await Promise.all(sessions.map(async (session) => {
        try {
            const reply = await session.customRequest('threads');
            return { session, threads: reply.threads || [] };
        } catch {
            return { session, threads: [] };
        }
    }));

    // 3. Flatten thread collections and scrape top execution frames concurrently
    const frameScrapeQueue: Promise<any | null>[] = [];
    for (const context of sessionThreads) {
        for (const thread of context.threads) {
            frameScrapeQueue.push((async () => {
                try {
                    const trace = await context.session.customRequest('stackTrace', {
                        threadId: thread.id,
                        startFrame: 0,
                        levels: 1
                    });
                    return {
                        sessionId: context.session.id,
                        threadId: thread.id,
                        threadName: thread.name,
                        topFrame: trace.stackFrames?.[0] || null
                    };
                } catch {
                    return null;
                }
            })());
        }
    }

    const rawCandidates = (await Promise.all(frameScrapeQueue))
        .filter((c): c is any => c !== null && c.topFrame !== null);

    if (rawCandidates.length === 0) {
        throw new Error("No valid execution context identified across subprocess threads");
    }

    // 4. Dispatch the collected candidates list to the background Rust Worker
    const sortedFrames = await wasmBridge.rankThreadCandidates(rawCandidates, workspaceRoot);
    
    if (!sortedFrames || sortedFrames.length === 0) {
        throw new Error("Rust layout validation failed to match a dominant thread context");
    }

    // Yield the most relevant execution candidate mapping the active debugging scope
    return sortedFrames[0];
}
```

---

## 6. Manifest Configuration (package.json)
```json
{
  "name": "debug-to-jupyter-rust",
  "displayName": "Debug to Jupyter (Rust Wasm)",
  "version": "1.1.0",
  "publisher": "sangnpq",
  "engines": { "vscode": "^1.75.0", "node": "20.x" },
  "main": "./out/extension.js",
  "extensionDependencies": ["ms-python.python"],
  "activationEvents": [],
  "contributes": {
    "configuration": {
      "d2j.logLevel": { 
        "type": "string", 
        "default": "info", 
        "enum": ["off", "error", "warning", "info", "debug"] 
      }
    },
    "commands": [
      { 
        "command": "d2j.sendToJupyter", 
        "title": "D2J: Send Variable to Jupyter Notebook", 
        "category": "Debug" 
      }
    ],
    "menus": {
      "debug/variables/context": [
        { 
          "command": "d2j.sendToJupyter", 
          "when": "debugState == stopped", 
          "group": "1_modification@1" 
        }
      ]
    }
  }
}
```