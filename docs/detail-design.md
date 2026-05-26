# Detailed Design: Debug to Jupyter (D2J)

## Overview

D2J is a VS Code extension that exports a live Python variable from an active debug session into a Jupyter Notebook (.ipynb), configured to use the same `.venv` as the debugged script.

**Repository:** The project root is the extension root (`memory2jupyter/`).

**Extension ID:** `debug-to-jupyter-rust`
**Activation:** `"onDebug"` (when any debug session starts)
**Primary Command:** `d2j.sendToJupyter` — triggered from right-click context menu on Debug Variables panel

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  extension   │───▶│   commands   │───▶│  wasmBridge  │  │
│  │  .ts         │    │  .ts         │    │  .ts         │  │
│  └──────────────┘    └──────┬───────┘    └──────────────┘  │
│                            │                    │           │
│                     ┌──────▼───────┐           │           │
│                     │  pythonEnv   │    ┌──────▼──────┐    │
│                     │  .ts         │    │  dapClient  │    │
│                     └──────────────┘    │  .ts         │    │
│                                        └──────────────┘    │
│                                                    │       │
│                          ┌──────────────────────────▼──────┐│
│                          │     notebookWriter.ts          ││
│                          └─────────────────────────────────┘│
│                                                            │
│  ┌──────────────────────────┐  ┌──────────────────────────┐ │
│  │    pkg/  (wasm-pack)     │  │   globalStorageUri/     │ │
│  │  debug_to_jupyter_rust   │  │   {varName}.pkl        │ │
│  │  .js + .wasm            │  └──────────────────────────┘ │
│  └──────────────────────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

### Workflow

1. User right-clicks a variable in the Debug Variables panel
2. `commands.ts` intercepts the click, extracts `varName` from `element.variable.name`
3. `pythonEnv.ts` resolves the active Python interpreter path and venv name via `ms-python.python` API
4. `pythonEnv.ts` checks/installs `joblib` and `ipykernel`, registers the kernel
5. `dapClient.ts` sends a DAP `evaluate` request: `joblib.dump(varName, path)` — executes in the debugged Python process
6. `wasmBridge.ts` calls the Rust/Wasm engine, passing varName, pklPath, venvName
7. `notebookWriter.ts` writes the `.ipynb` file to the workspace and opens it

---

## Build System

### No Bundler
VS Code's extension host loads CommonJS directly from `out/`. No esbuild/webpack needed for v1. A bundler can be added later for VSIX size optimization.

### Build Order (DAG)

```
wasm-pack build  (cargo → pkg/)
        │
        ▼
tsc -p tsconfig.json  (src/*.ts → out/*.js)
        │
        ▼
vsce package  (out/ + pkg/ + package.json → *.vsix)
```

### npm Scripts

| Script | Command | Purpose |
|---|---|---|
| `build:wasm` | `cd cargo && wasm-pack build --target nodejs --out-dir ../pkg --release` | Compile Rust to Wasm |
| `build:ts` | `tsc -p tsconfig.json` | Compile TypeScript |
| `build` | `npm run build:wasm && npm run build:ts` | Full build |
| `watch:ts` | `tsc -p tsconfig.json --watch` | Watch mode |
| `package` | `npm run build && vsce package` | Build .vsix |

`wasm-pack --target nodejs` is critical — it generates CommonJS-compatible JS glue with `require()` that works in VS Code's Node.js extension host. `wasm-pack --target web` or `--target bundler` would not work.

---

## Rust Wasm Module (`cargo/src/lib.rs`)

### `generate_jupyter_notebook(var_name, pkl_path, venv_name) -> String`

**Responsibility:** Given a variable name, pickle file path, and venv name, produce a valid nbformat 4.5 Jupyter Notebook JSON string.

### nbformat 4.5 JSON Structure

```json
{
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": {
    "kernelspec": {
      "display_name": "Python 3 ({venv_name})",
      "name": "python3_{sanitized-venv-name}"
    },
    "language_info": {
      "name": "python",
      "codemirror_mode": {"name": "ipython", "version": 3},
      "file_extension": ".py",
      "mimetype": "text/x-python",
      "pygments_lexer": "python3"
    }
  },
  "cells": [
    {
      "cell_type": "markdown",
      "id": "d2j-header",
      "metadata": {},
      "source": ["# Debug to Jupyter Export\n", "\n", "Variable: `{var_name}`\n"]
    },
    {
      "cell_type": "code",
      "execution_count": null,
      "id": "d2j-load",
      "metadata": {},
      "outputs": [],
      "source": [
        "import joblib\n",
        "{var_name} = joblib.load('{escaped-pkl-path}')\n",
        "print(f'Loaded {type(var_name).__name__}: {var_name}')\n"
      ]
    }
  ]
}
```

### Validation & Normalization

| Step | Logic |
|---|---|
| Empty `var_name` | Return error JSON: `{"error": "...", "kind": "EmptyVarName"}` |
| Empty `pkl_path` | Return error JSON: `{"error": "...", "kind": "EmptyPklPath"}` |
| Empty `venv_name` | Return error JSON: `{"error": "...", "kind": "EmptyVenvName"}` |
| Windows path | Replace `\` with `/` before embedding in Python string |
| Single quotes in path | Escape as `\'` in the Python code |
| Kernel name sanitization | `venv_name` → lowercase, non-alphanumeric chars → `-`, trim leading/trailing `-` |

### Testing

Rust unit tests run natively with `cargo test` (no Wasm needed):

```
test_generate_notebook_basic
test_empty_var_name_returns_error
test_empty_pkl_path_returns_error
test_empty_venv_name_returns_error
test_windows_path_normalization       # \ → / in generated Python code
test_sanitize_id                    # special chars → hyphens
test_kernel_name_format             # python3-{venv} pattern
test_cell_ids_valid                 # IDs match ^[a-zA-Z0-9-_]+$
test_single_quotes_in_path           # paths with ' are escaped
```

---

## TypeScript Modules (6 modules)

### `src/extension.ts` — Entry Point

```typescript
export async function activate(context: vscode.ExtensionContext) {
    const wasmBridge = new WasmBridge(context);
    await wasmBridge.initialize();
    const disposable = vscode.commands.registerCommand('d2j.sendToJupyter', handleSendToJupyter);
    context.subscriptions.push(disposable);
}

export function deactivate() {}  // no-op
```

### `src/commands.ts` — Orchestration

```typescript
export async function handleSendToJupyter(element, wasmBridge, context) {
    // 1. Validate preconditions
    // 2. Resolve Python environment
    // 3. Ensure joblib + ipykernel
    // 4. DAP evaluate → dump to .pkl
    // 5. Generate notebook via Wasm
    // 6. Write and open notebook
    // All wrapped in vscode.window.withProgress for UX
}
```

`element` comes from the `view/item/context` menu on `debugVariables`:

```typescript
interface DebugVariableElement {
    variable: { name: string; value: string; variablesReference: number };
    session: vscode.DebugSession;
}
```

### `src/dapClient.ts` — Debug Adapter Protocol

```typescript
export async function evaluateDapExpression(
    session: vscode.DebugSession,
    expression: string,
    frameId?: number
): Promise<string> {
    const args: vscode.DebugProtocol.EvaluateArguments = {
        expression,
        context: 'repl',  // critical: enables side-effecting expressions in debugpy
    };
    if (frameId !== undefined) args.frameId = frameId;
    const response = await session.customRequest('evaluate', args);
    return response.body.result;
}
```

**DAP detail:** `context: 'repl'` is required for side-effecting evaluate expressions (like `joblib.dump`). Without it, some debug adapters refuse to run code with side effects. Debugpy (the standard Python debug adapter) supports this.

### `src/pythonEnv.ts` — Python Environment

```typescript
export async function resolvePythonEnvironment(): Promise<PythonEnvironment | undefined>
// Resolves via ms-python.python API.
// Preferred: api.environments.getActiveEnvironmentPath() → resolveEnvironment()
// Fallback: api.settings.getExecutionDetails()

export async function ensurePythonPackages(pythonPath: string): Promise<void>
// Step 1: python -c "import joblib, ipykernel" → if fails:
// Step 2: python -m pip install joblib ipykernel  (120s timeout)
// Step 3: python -m ipykernel install --user --name=...  (30s timeout) — non-fatal
```

**venv name extraction** from Python executable path:
- Look for `.venv`, `env`, or `venv` directory in the path
- Fall back to the parent directory of `bin/` or `Scripts/`

### `src/wasmBridge.ts` — Wasm Loading

```typescript
export class WasmBridge {
    async initialize(): Promise<void>
    // require() the pkg/ JS glue (synchronous with --target nodejs)

    generateNotebook(varName: string, pklPath: string, venvName: string): string
    // Call wasm function, parse result. If {"error":...}, throw.
}
```

**Important:** Using `--target nodejs` means the `require()` call in `initialize()` synchronously compiles and instantiates the Wasm module. No async memory initialization is needed. This is a key difference from `--target web`.

### `src/notebookWriter.ts` — Notebook File Operations

```typescript
export async function writeAndOpenNotebook(
    notebookJson: string,
    varName: string,
    workspaceRoot: string
): Promise<void>
// 1. Ensure globalStorageUri directory exists (vscode.workspace.fs.createDirectory)
// 2. Write to workspaceRoot/D2J_{varName}.ipynb
// 3. Open with vscode.openWith(uri, 'jupyter-notebook')
// 4. Show success message
```

### `src/errors.ts` — Error Handling

```typescript
export class D2JError extends Error {
    constructor(
        public readonly kind: string,
        message: string,
        public readonly severity: vscode.MessageSeverity = vscode.MessageSeverity.Error
    )
}

export function showError(err: unknown): void
// Map D2JError.kind → user-friendly message → vscode.window.showErrorMessage
```

---

## Error Catalog

| Kind | Condition | Severity | User Message |
|---|---|---|---|
| `noWorkspace` | No workspace folder open | Error | "No workspace is open. Please open a folder before using D2J." |
| `noDebugSession` | No active debug session | Error | "No active debug session. Start debugging first." |
| `pythonExtNotInstalled` | `ms-python.python` not found | Error | "The Python extension is required. Install it from the marketplace." |
| `noPythonEnv` | Python ext found but no interpreter | Error | "Could not detect a Python environment. Select a interpreter." |
| `pipInstallFailed` | `pip install joblib ipykernel` fails | Error | Full error + manual pip command |
| `dapEvaluateFailed` | DAP evaluate returns error | Error | "Failed to dump variable. It may not support serialization." |
| `dapSessionLost` | Debug session ends mid-evaluation | Error | "Debug session ended while dumping the variable." |
| `wasmLoadFailed` | `require('pkg/...')` throws | Error | "Failed to load notebook generator. Try reinstalling." |
| `wasmGenerateError` | Rust returns error JSON | Error | Propagated from Rust with kind and message |
| `fileWriteFailed` | `fs.writeFile` rejects | Error | "Failed to write notebook. Check workspace permissions." |
| `kernelRegFailed` | `ipykernel install` fails | Warning | "Could not register kernel. Select one manually." |
| `invalidVariable` | Variable name empty/invalid | Error | "Invalid variable selected." |

---

## Cross-Platform Path Handling

| Context | Approach |
|---|---|
| DAP evaluate (Python code) | `r'C:/path/to/file.pkl'` — Python raw strings, forward slashes work on all platforms |
| Rust Wasm (Python string in JSON) | Normalize `\` to `/` inside Rust before embedding |
| Node.js `fs` operations | Always `path.join()` or `vscode.Uri.joinPath()` |
| Shell commands in `execFile` | Wrap Python path in double quotes: `"${pythonPath}" -m pip ...` |

---

## package.json Details

```json
{
  "name": "debug-to-jupyter-rust",
  "displayName": "Debug to Jupyter (Rust Wasm)",
  "version": "1.0.0",
  "publisher": "your-name",
  "engines": { "vscode": "^1.75.0" },
  "activationEvents": ["onDebug"],
  "main": "./out/extension.js",
  "extensionDependencies": ["ms-python.python"],
  "contributes": {
    "commands": [
      {
        "command": "d2j.sendToJupyter",
        "title": "Gửi sang Jupyter Notebook",
        "category": "Debug"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "d2j.sendToJupyter",
          "when": "view == debugVariables",
          "group": "inline"
        }
      ]
    }
  },
  "files": ["out/**", "pkg/**"]
}
```

**`extensionDependencies`** ensures VS Code auto-prompts the user to install `ms-python.python` if it's missing — no need for manual version checks.

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| wasm-pack Node.js ABI mismatch | `--target nodejs` produces pure `.wasm` with standard WebAssembly API — no native addon ABI |
| DAP evaluate side effects blocked | Use `context: 'repl'` — debugpy supports this. Fall back to no context if it fails. |
| Large variable serialization hangs | Progress notification keeps user informed. Document in README. |
| globalStorageUri not a file URI | Create dir with `vscode.workspace.fs.createDirectory()` before writing |
| Repeated quick invocations | `joblib.dump` serialized by debug session's single-threaded eval; `writeFile` overwrites — acceptable |
