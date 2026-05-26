import * as vscode from 'vscode';
import * as path from 'path';

export class WasmBridge {
    private generateNotebookFn: ((varName: string, pklPath: string, venvName: string) => string) | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    async initialize(): Promise<void> {
        try {
            const extensionPath = this.context.extensionPath;
            const wasmModule = require(path.join(extensionPath, 'pkg', 'debug_to_jupyter_rust.js'));
            this.generateNotebookFn = wasmModule.generate_jupyter_notebook;
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to load Wasm module: ${err}`);
            throw err;
        }
    }

    generateNotebook(varName: string, pklPath: string, venvName: string): string {
        if (!this.generateNotebookFn) {
            throw new Error('Wasm module not initialized. Call initialize() first.');
        }

        const result = this.generateNotebookFn(varName, pklPath, venvName);

        try {
            const parsed = JSON.parse(result);
            if (parsed.error) {
                throw new Error(`Notebook generation error (${parsed.kind}): ${parsed.error}`);
            }
        } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message.includes('Notebook generation error')) {
                throw parseErr;
            }
        }

        return result;
    }
}
