import * as vscode from 'vscode';
import * as path from 'path';

export interface RankedFrame {
    thread_id: number;
    thread_name: string;
    frame_id: number;
    source_path?: string;
    line?: number;
    score: number;
}

export class WasmBridge {
    private generateNotebookFn: ((varName: string, pklPath: string, venvName: string) => string) | undefined;
    private rankThreadCandidatesFn: ((candidatesJson: string, workspaceRoot: string) => string) | undefined;
    private isVirtualSourceFn: ((sourceJson: string) => string) | undefined;
    private sanitizeSourcePathFn: ((sourcePath: string, workspaceRoot: string) => string) | undefined;
    private formatTimestampFn: (() => string) | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    async initialize(): Promise<void> {
        try {
            const extensionPath = this.context.extensionPath;
            const wasmModule = require(path.join(extensionPath, 'pkg', 'debug_to_jupyter_rust.js'));
            this.generateNotebookFn = wasmModule.generate_jupyter_notebook;
            this.rankThreadCandidatesFn = wasmModule.rank_thread_candidates;
            this.isVirtualSourceFn = wasmModule.is_virtual_source_wasm;
            this.sanitizeSourcePathFn = wasmModule.sanitize_source_path_fn;
            this.formatTimestampFn = wasmModule.format_timestamp_fn;
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

    rankThreadCandidates(candidates: unknown[], workspaceRoot: string): RankedFrame[] {
        if (!this.rankThreadCandidatesFn) {
            throw new Error('Wasm module not initialized. Call initialize() first.');
        }
        const candidatesJson = JSON.stringify(candidates);
        const result = this.rankThreadCandidatesFn(candidatesJson, workspaceRoot);
        const parsed = JSON.parse(result);
        if (parsed.error) {
            throw new Error(`Rank thread candidates error (${parsed.kind}): ${parsed.error}`);
        }
        return parsed as RankedFrame[];
    }

    isVirtualSource(source: { path?: string; name?: string; sourceReference?: number }): boolean {
        if (!this.isVirtualSourceFn) {
            const src = source;
            if (src.sourceReference && src.sourceReference > 0) return true;
            if (src.path === '<string>' || src.path === '<stdin>' || src.path === '<repl>') return true;
            if (!src.path && !src.name) return true;
            return false;
        }
        const sourceJson = JSON.stringify({
            path: source.path ?? null,
            name: source.name ?? null,
            source_reference: source.sourceReference ?? null,
        });
        const result = this.isVirtualSourceFn(sourceJson);
        const parsed = JSON.parse(result);
        if (parsed.error) {
            const src = source;
            if (src.sourceReference && src.sourceReference > 0) return true;
            if (src.path === '<string>' || src.path === '<stdin>' || src.path === '<repl>') return true;
            if (!src.path && !src.name) return true;
            return false;
        }
        return parsed.isVirtual as boolean;
    }

    sanitizeSourcePath(sourcePath: string, workspaceRoot: string): string {
        if (!this.sanitizeSourcePathFn) {
            return this.sanitizeSourcePathFallback(sourcePath, workspaceRoot);
        }
        return this.sanitizeSourcePathFn(sourcePath, workspaceRoot);
    }

    formatTimestamp(): string {
        if (!this.formatTimestampFn) {
            return this.formatTimestampFallback();
        }
        return this.formatTimestampFn();
    }

    private sanitizeSourcePathFallback(sourcePath: string, workspaceRoot: string): string {
        const normalizedSource = sourcePath.replace(/\\/g, '/');
        const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
        const relative = path.posix.relative(normalizedRoot, normalizedSource);
        let result: string;
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            result = path.basename(sourcePath);
        } else {
            result = relative.replace(/[/\\]/g, '_');
        }
        const ext = path.posix.extname(result);
        if (ext) {
            result = result.slice(0, -ext.length);
        }
        result = result.replace(/[^a-zA-Z0-9_.-]/g, '_');
        return result;
    }

    private formatTimestampFallback(): string {
        const now = new Date();
        const y = now.getFullYear().toString();
        const mo = (now.getMonth() + 1).toString().padStart(2, '0');
        const d = now.getDate().toString().padStart(2, '0');
        const h = now.getHours().toString().padStart(2, '0');
        const mi = now.getMinutes().toString().padStart(2, '0');
        const s = now.getSeconds().toString().padStart(2, '0');
        return `${y}${mo}${d}${h}${mi}${s}`;
    }
}
