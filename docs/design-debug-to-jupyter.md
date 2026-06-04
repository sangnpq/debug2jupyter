# Debug to Jupyter (D2J) Specification Overview

## Overview

D2J is a high-performance, fault-tolerant VS Code extension that exports live Python variables from active, paused debug sessions directly into an automated Jupyter Notebook (`.ipynb`). It unifies execution environments by configuring the notebook to map directly onto the active process's target virtual environment (`.venv`).

**Extension ID:** `debug-to-jupyter-rust`  
**Activation:** Lazy-loaded (Triggered purely via user context invocation)  
**Command:** `d2j.sendToJupyter`  

## Tech Stack

- **TypeScript** — High-concurrency orchestration using async event loops (`Promise.all`) to communicate with the VS Code Extension Host.
- **Node.js Worker Threads** — Multi-threaded isolation layer preventing UI thread locking and managing asynchronous WebAssembly message resolution.
- **Rust + WebAssembly** — Highly optimized, vectorized calculation engine compiled via `wasm-pack` running inside the background Worker context.
- **Debug Adapter Protocol (DAP)** — Low-latency diagnostic pipeline handling concurrent process variable lookups.
- **Python Runtime** — Standard library `pickle.Pickler` with a dynamic lifecycle override system for isolated, closure-safe data serialization.

## Workflow

1. **Context Trigger:** The user right-clicks a target element within the VS Code *Debug Variables* panel during a suspended (`stopped`) debug phase.
2. **Expression Evaluation:** `handleSendToJupyter` extracts the context-aware reference path using `element.variable.evaluateName` to correctly handle nested child configurations or class instance properties.
3. **Environment Sync:** `resolvePythonEnvironment` accesses target path metrics through the official `ms-python.python` Extension API wrapper.
4. **Dependency Resolution:** `ensurePythonPackages` performs non-destructive environment checks, requests explicit authorization prior to execution, and registers the local virtual runtime kernel via `ipykernel`.
5. **Concurrent Frame Scraping:** `resolveCurrentFrameId` maps across all available parent debug sessions, child subprocesses, and isolated background threads concurrently via `Promise.all()`.
6. **Worker Offloading:** The raw thread metadata maps are handed directly over to a background Node.js Worker Thread, where the **Rust WebAssembly** module filters, grades, and isolates the most pertinent frame context using multi-threaded vectorized matching. *The background worker layer explicitly checks and awaits the Wasm execution lifecycle to pass a fully evaluated string payload back to the Extension Host.*
7. **Closure-Safe Serialization:** The extension pushes an atomic Python evaluation script into the target frame. This uses a custom `Pickler` with a lifecycle interceptor (`reducer_override`) to drop or stringify unpicklable elements (closures, local functions, active lock handles) without mutating live data.
8. **Notebook Compilation:** `WasmBridge.generateNotebook` formats structural coordinates into a compliant `nbformat 4.5` workspace document.
9. **Persistence Layer:** `writeAndOpenNotebook` writes output targets to an isolated `.d2j_store/` partition, updates local `.gitignore` rules automatically, and boots up the native interactive interface.

## Project Structure

## Project Structure

```
debug-to-jupyter-rust/
├── src/                      # TypeScript Source Directory
│   ├── extension.ts          # Core extension entry point & lazy activation hooks
│   ├── commands.ts           # handleSendToJupyter lifecycle & transactional engine
│   ├── dapClient.ts          # Concurrent DAP multiplexer & exponential backoff handler
│   ├── pythonEnv.ts          # Virtual environment inspector & kernel mounter
│   ├── wasmBridge.ts         # Worker Thread supervisor & Wasm linear memory gateway
│   ├── wasmWorker.js         # Dedicated background Node.js execution script (Defensive Await)
│   ├── notebookWriter.ts     # Document I/O layer & native cell execution controller
│   ├── errors.ts             # Domain-specific error mappings & crash mitigations
│   ├── logger.ts             # Layered diagnostic OutputChannel stream router
│   └── utils.ts              # File layout helpers & automated .gitignore mutators
├── cargo/src/lib.rs          # Rust Core Engine (Vectorized frame grading & parsing)
├── pkg/                      # wasm-pack compiled output (CJS modules + binary assets)
├── out/                      # Transpiled extension execution files
├── package.json              # Extension manifest, context mappings & lazy load bindings
└── tsconfig.json             # TypeScript structural compiler configuration
```

## Key Design Decisions

- **No Bundler Overhead** — The extension host directly consumes clean CommonJS artifacts compiled natively into `out/`, ensuring straightforward compilation maintenance.
- **Promise-Resilient Worker-Isolated Wasm Interop** — To prevent locking the main VS Code UI thread, the Wasm module is executed inside a background Node.js Worker Thread. Crucially, the worker implements defensive unwrapping logic (`instanceof Promise`) to guarantee that all serialized structures returned by the Wasm bindings are fully evaluated into raw strings before transmission. This completely eliminates unresolved `[object Promise]` deserialization syntax errors in the Extension Host.
- **Closure-Resilient Native Serialization** — Standard serialization crashes with a `PicklingError` when variables contain locally scoped methods, lambdas, or closures. D2J resolves this entirely without dependency overhead by injecting a custom native `pickle.Pickler` class that dynamically intercepts and stringifies unpicklable objects using `reducer_override`.
- **Git & Workspace Protection** — Variable exports and cache configurations are completely isolated inside a hidden workspace folder named `.d2j_store/`. The utility automatically mutates the project's `.gitignore` file to ensure heavy datasets are never accidentally tracked or committed to repositories.
- **Optimized Lazy Activation** — Discarded general `"onDebug"` event listeners. The extension engine remains inactive until a user interacts with the context menu to keep VS Code's baseline resource utilization clean.