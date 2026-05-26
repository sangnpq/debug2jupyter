# Debug to Jupyter (D2J)

Export a live Python variable from an active VS Code debug session directly into a Jupyter Notebook, configured to use the same virtual environment as the debugged script.

## Features

- **One-click export**: Right-click any variable in the Debug Variables panel and select "Gửi sang Jupyter Notebook"
- **Automatic environment setup**: Automatically installs `joblib` and `ipykernel` if missing
- **Matched kernel**: The generated notebook is pre-configured to use the same `.venv` as your debug session
- **Works on Windows and Linux**: Full cross-platform support with corrected path handling

## Requirements

- VS Code `^1.75.0`
- [Python extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (installed automatically as a dependency)
- Python `3.x` with a virtual environment (`.venv`)

## Installation

### From Source

```bash
# 1. Install npm dependencies
npm install

# 2. Install wasm-pack (https://rustwasm.github.io/wasm-pack/)
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# 3. Build the extension
npm run build

# 4. Package as VSIX (optional)
npm run package
```

To install the `.vsix` file: `code --install-extension debug-to-jupyter-rust-*.vsix`

### Development

Press **F5** in VS Code to launch the Extension Development Host. Set breakpoints in `src/` to debug.

## Usage

1. Open a Python project with a `.venv`
2. Set a breakpoint in a Python file
3. Start debugging (F5)
4. When paused, right-click any variable in the **Debug Variables** panel
5. Select **Gửi sang Jupyter Notebook**
6. The notebook file (`D2J_{varName}.ipynb`) is created in your workspace and opened automatically

## How It Works

1. Resolves the active Python interpreter from the Python extension
2. Checks for and installs `joblib` and `ipykernel` if not already present
3. Uses the Debug Adapter Protocol (DAP) `evaluate` request to run `joblib.dump()` in the live debug session — the variable is serialized directly from memory
4. Generates a valid `.ipynb` (nbformat 4.5) notebook via a Rust/WebAssembly engine
5. Writes and opens the notebook in VS Code

## Building

| Command | Description |
|---|---|
| `npm run build:wasm` | Compile Rust to WebAssembly |
| `npm run build:ts` | Compile TypeScript |
| `npm run build` | Full build (Wasm + TypeScript) |
| `npm run watch:ts` | Watch mode for TypeScript |
| `npm run package` | Build and package as `.vsix` |

## Architecture

```
src/
  extension.ts     — Entry point
  commands.ts     — Orchestrates the full workflow
  pythonEnv.ts    — Resolves Python environment & manages packages
  dapClient.ts    — DAP evaluate requests
  wasmBridge.ts   — Rust/Wasm module loader
  notebookWriter.ts — File write & open notebook
  errors.ts       — Typed error handling

cargo/src/lib.rs  — Rust WebAssembly engine (nbformat 4.5 notebook generation)
```

## Troubleshooting

**"No active debug session"**
Start debugging (F5) before using D2J. The context menu only appears during active debug sessions.

**"Could not detect a Python environment"**
Ensure the Python extension is installed and an interpreter is selected (`ms-python.python: Select Interpreter`).

**Variable not loading in notebook**
Some variables cannot be pickled (e.g., lambdas, socket objects, certain class instances). D2J uses `joblib.dump()` which has the same limitations.

**"Failed to load Wasm module"**
Run `npm run build:wasm` to rebuild the Rust → WebAssembly module. Make sure `wasm-pack` is installed.

## License

MIT
