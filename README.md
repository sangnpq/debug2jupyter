# Debug to Jupyter (D2J)

A VS Code extension that exports a live Python variable from an active debug session directly into a Jupyter Notebook, configured to use the same virtual environment as the debugged script.

## Features

- **One-click export**: Right-click any variable in the Debug Variables panel while paused and select **Send to Jupyter Notebook**
- **Automatic environment setup**: Installs `joblib` and `ipykernel` if missing (supports both `pip` and `uv`)
- **Matched kernel**: The generated notebook is pre-configured to use the same Python virtual environment as your debug session
- **Auto-execution**: The notebook is opened and the load cell is executed automatically
- **Smart frame resolution**: Automatically finds the correct stack frame containing your variable across multiple threads, using a Rust/WASM scoring engine
- **Cross-platform**: Full Windows and Linux support with normalized path handling
- **Rust/Wasm core**: Notebook generation, thread ranking, path sanitization, and timestamp formatting all run in Rust/WebAssembly

## Requirements

- VS Code `^1.75.0`
- [Python extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (auto-installed as a dependency)
- Python 3.x with a virtual environment (`.venv`, `env`, or `venv`)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/) (for building from source)

## Installation

### From Source

```bash
# 1. Install npm dependencies
npm install

# 2. Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# 3. Build the extension (Rust Wasm + TypeScript)
npm run build

# 4. Package as VSIX (optional)
npm run package
```

Install the `.vsix` file: `code --install-extension debug-to-jupyter-rust-1.0.0.vsix`

### Development

Press **F5** in VS Code to launch the Extension Development Host. Set breakpoints in `src/` to debug.

## Usage

1. Open a Python project with a virtual environment
2. Set a breakpoint in a Python file
3. Start debugging (F5)
4. When paused at a breakpoint, right-click any variable in the **Debug Variables** panel
5. Select **Send to Jupyter Notebook**
6. A notebook file (e.g., `src_main_20260529120000.ipynb`) is created in `.vscode/scripts/` and opened automatically
7. The load cell executes automatically, deserializing your variable with `joblib.load()`

## Building

| Command | Description |
|---|---|
| `npm run build:wasm` | Compile Rust to WebAssembly (release) |
| `npm run build:wasm:dev` | Compile Rust to WebAssembly (dev, with debug info) |
| `npm run build:ts` | Compile TypeScript |
| `npm run build` | Full build (Wasm + TypeScript) |
| `npm run watch:ts` | Watch mode for TypeScript |
| `npm run package` | Build and package as `.vsix` |
| `npm test` | Run Vitest unit tests |

## Testing

**TypeScript (Vitest):**
```bash
npm test
```

**Rust (Cargo):**
```bash
cd cargo && cargo test
```

## File Locations

| Artifact | Path |
|---|---|
| Pickle file (temporary) | `.vscode/tmp/{source}_{line}_{varName}_{timestamp}.pkl` |
| Notebook file | `.vscode/scripts/{source}_{timestamp}.ipynb` |
| D2J output log | VS Code Output panel → "D2J" channel |

## Troubleshooting

**"No active debug session"**
Start debugging (F5) before using D2J. The context menu only appears when `debugState == stopped`.

**"Could not detect a Python environment"**
Ensure the Python extension is installed and an interpreter is selected (`ms-python.python: Select Interpreter`).

**"Failed to install joblib/ipykernel"**
Both `pip` and `uv` were tried. Run manually: `python -m pip install joblib ipykernel` or `uv pip install joblib ipykernel`.

**Variable not loading in notebook**
Some variables cannot be pickled (e.g., lambdas, socket objects, certain class instances). D2J uses `joblib.dump()` which has the same limitations as pickle.

**"Failed to load Wasm module"**
Run `npm run build:wasm` to rebuild the Rust → WebAssembly module. Make sure `wasm-pack` is installed.

**Stale frame errors**
The extension automatically retries with exponential backoff (up to 10 attempts). If it still fails, try stepping one line in the debugger before retrying.

## License

MIT