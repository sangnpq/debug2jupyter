import * as vscode from 'vscode';
import * as path from 'path';
import { Worker } from 'worker_threads';

export interface RankedFrame {
    thread_id: number;
    thread_name: string;
    frame_id: number;
    source_path?: string;
    line?: number;
    score: number;
}

export class WasmBridge {
    private worker: Worker | null = null;
    private messageCounter = 0;
    private startupError: string | null = null;

    constructor(private context: vscode.ExtensionContext) {}

    async initialize(): Promise<void> {
        try {
            if (this.worker) return;
            const extensionPath = this.context.extensionPath;
            const workerPath = path.join(extensionPath, 'out', 'wasmWorker.js');
            this.worker = new Worker(workerPath);

            // Capture explicit asynchronous boot exceptions sent from the thread channel
            this.worker.on('message', (msg) => {
                if (msg.id === 0 && msg.error) {
                    this.startupError = msg.error;
                }
            });

            this.worker.on('error', (err) => {
                console.error('[WasmBridge] Worker lifecycle crash:', err);
                this.startupError = err.message;
            });

            this.worker.on('exit', (code) => {
                console.warn(`[WasmBridge] Worker thread exited with code: ${code}`);
                this.worker = null;
            });

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to initialize Wasm Worker: ${err}`);
            throw err;
        }
    }

    private async callWorker<T>(action: string, payload: Record<string, unknown>): Promise<T> {
        if (!this.worker) {
            if (this.startupError) {
                throw new Error(`Wasm Worker crashed during startup: ${this.startupError}. Check your build directory layout.`);
            }
            throw new Error('Wasm Worker not initialized or terminated unexpectedly.');
        }

        return new Promise((resolve, reject) => {
            const workerInstance = this.worker!;
            const messageId = ++this.messageCounter;
            const timeoutMs = 30000;
            
            const timeoutHandle = setTimeout(() => {
                workerInstance.off('message', handleMessage);
                reject(new Error(`Wasm callWorker timeout after ${timeoutMs}ms for action=${action}`));
            }, timeoutMs);

            const handleMessage = (msg: any) => {
                if (msg.id === messageId) {
                    clearTimeout(timeoutHandle);
                    workerInstance.off('message', handleMessage);
                    if (msg.error) reject(new Error(msg.error));
                    else {
                        try {
                            const parsedData = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
                            resolve(parsedData);
                        } catch (parseError: any) {
                            reject(new Error(`D2J JSON Parse Error: ${parseError.message}`));
                        }
                    }
                }
            };

            workerInstance.on('message', handleMessage);
            workerInstance.postMessage({ id: messageId, action, ...payload });
        });
    }

    async generateNotebook(varName: string, pklPath: string, venvName: string): Promise<string> {
        const result = await this.callWorker<any>('generateNotebook', { varName, pklPath, venvName });
        if (result && result.error) throw new Error(`Notebook generation error: ${result.error}`);
        return typeof result === 'string' ? result : JSON.stringify(result);
    }

    async rankThreadCandidates(candidates: any[], workspaceRoot: string): Promise<any[]> {
        return this.callWorker<any[]>('rankThreads', { candidates: JSON.stringify(candidates), workspaceRoot });
    }

    async isVirtualSource(source: { path?: string; name?: string; sourceReference?: number }): Promise<boolean> {
        const sourceJson = JSON.stringify({
            path: source.path ?? null,
            name: source.name ?? null,
            source_reference: source.sourceReference ?? null,
        });
        try {
            const result = await this.callWorker<any>('isVirtualSource', { sourceJson });
            if (result && result.error) return this.isVirtualSourceFallback(source);
            return result.isVirtual as boolean;
        } catch {
            return this.isVirtualSourceFallback(source);
        }
    }

    private isVirtualSourceFallback(source: { path?: string; name?: string; sourceReference?: number }): boolean {
        if (source.sourceReference && source.sourceReference > 0) return true;
        if (source.path === '<string>' || source.path === '<stdin>' || source.path === '<repl>') return true;
        if (!source.path && !source.name) return true;
        return false;
    }

    async sanitizeSourcePath(sourcePath: string, workspaceRoot: string): Promise<string> {
        try {
            return await this.callWorker<string>('sanitizeSourcePath', { sourcePath, workspaceRoot });
        } catch {
            return this.sanitizeSourcePathFallback(sourcePath, workspaceRoot);
        }
    }

    async formatTimestamp(): Promise<string> {
        try {
            return await this.callWorker<string>('formatTimestamp', {});
        } catch {
            return this.formatTimestampFallback();
        }
    }

    private sanitizeSourcePathFallback(sourcePath: string, workspaceRoot: string): string {
        const normalizedSource = sourcePath.replace(/\\/g, '/');
        const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
        const relative = path.posix.relative(normalizedRoot, normalizedSource);
        let result = (relative.startsWith('..') || path.isAbsolute(relative)) ? path.basename(sourcePath) : relative.replace(/[/\\]/g, '_');
        const ext = path.posix.extname(result);
        if (ext) result = result.slice(0, -ext.length);
        return result.replace(/[^a-zA-Z0-9_.-]/g, '_');
    }

    private formatTimestampFallback(): string {
        const now = new Date();
        return `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    }
}