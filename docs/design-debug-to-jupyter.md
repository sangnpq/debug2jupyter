# Debug to Jupyter (D2J) Specification Overview

## Overview

D2J is a performance-optimized VS Code extension that exports live Python variables directly from an active debug session into a newly generated Jupyter Notebook (`.ipynb`). It configures the notebook to use the exact execution context and environment (`.venv`) as the debugged script.

**Extension ID:** `debug-to-jupyter-rust`  
**Activation:** Lazy-loaded (Zero-impact on standard debug sessions)  
**Command:** `d2j.sendToJupyter`  

## Tech Stack

- **TypeScript** — VS Code Extension API orchestration and user interface lifecycle.
- **Rust + WebAssembly** — High-performance, synchronous data-structure processing and notebook JSON structure generation via `wasm-pack`.
- **Debug Adapter Protocol (DAP)** — Low-overhead runtime evaluation via `evaluate` requests to inspect stack traces and handle inline serialization.
- **Python Runtime** — Standard library `pickle` module for dependency-free object serialization, combined with `ipykernel` for automated Jupyter kernel mounting.

## Workflow

1. **Trigger:** The user right-clicks a target variable inside the VS Code *Debug Variables* panel while execution is paused.
2. **Expression Evaluation:** `handleSendToJupyter` extracts the context-aware reference path using `element.variable.evaluateName` (safely falling back to `.name` only if evaluation expressions are absent) to support deep object/list attributes.
3. **Environment Resolution:** `resolvePythonEnvironment` accesses the active interpreter using the official `ms-python.python` extension API.
4. **Kernel Management:** `ensurePythonPackages` non-destructively verifies `ipykernel` presence, prompts the user for explicit permission before attempting automated installations (`uv` prioritized, falling back to `pip`), and handles implicit kernel registry hooks.
5. **Context Ranking:** `resolveCurrentFrameId` queries active execution frames, routing them into the WebAssembly runtime to filter and rank the most suitable active frame via Rust.
6. **In-Memory Serializing:** `evaluateDapExpression` forces the active debug process to serialize the target evaluation statement into a temporary payload file on disk using Python's native `pickle` module.
7. **Document Synthesis:** `WasmBridge.generateNotebook` synchronously parses paths, variables, and kernel metadata into a compliant `nbformat 4.5` JSON layout inside the Wasm execution layer.
8. **Mount & Render:** `writeAndOpenNotebook` writes the file to the local `.d2j_store/` workspace directory, appends data rules to `.gitignore`, and natively boots the interactive notebook interface.

## Project Structure

```
debug-to-jupyter-rust/
├── src/                      # TypeScript Source Modules
│   ├── extension.ts          # Extension entry point & lifecycle hooks
│   ├── commands.ts           # handleSendToJupyter transactional orchestration
│   ├── dapClient.ts          # DAP execution abstraction, frame tracking & evaluation
│   ├── pythonEnv.ts          # Core python environment & kernel management
│   ├── wasmBridge.ts         # Native WebAssembly bridge driver & string marshaling
│   ├── notebookWriter.ts     # Document file-system I/O & UI rendering
│   ├── errors.ts             # D2JError domains & user-facing message translation
│   ├── logger.ts             # Configurable OutputChannel debug logging streams
│   └── utils.ts              # File manipulation helpers & git safety guards
├── cargo/src/lib.rs          # Rust Source (Core high-performance Wasm module)
├── pkg/                      # wasm-pack compiled build output (generated CommonJS)
├── out/                      # TypeScript target compiler output (generated JavaScript)
├── package.json              # Extension manifest & context-menu bindings
└── tsconfig.json             # TypeScript configuration parameters
```

## Key Design Decisions

- **No Bundler Overhead** — The extension host directly consumes clean CommonJS artifacts compiled natively into `out/`, ensuring straightforward compilation maintenance.
- **Synchronous WebAssembly Interop** — `wasm-pack --target nodejs` compiles the module into a zero-dependency package, allowing TypeScript to invoke high-speed Rust handlers instantly using standard Node.js `require()` interfaces.
- **Zero Third-Party Runtime Dependencies** — Replaced `joblib` with Python's standard library `pickle` module. This drops installation requirements down to just `ipykernel`, reducing runtime crashes on restrictive machines.
- **Git & Workspace Protection** — Variable exports and cache configurations are completely isolated inside a hidden workspace folder named `.d2j_store/`. The utility automatically mutates the project's `.gitignore` file to ensure heavy datasets are never committed to repositories.
- **Optimized Lazy Activation** — Discarded general `"onDebug"` event listeners. The extension engine remains inactive until a user interacts with the context menu to keep VS Code's baseline resource utilization clean.
```