import * as vscode from 'vscode';
import { handleSendToJupyter, DebugVariableElement } from './commands';
import { WasmBridge } from './wasmBridge';
import { initLogger } from './logger';

let wasmBridge: WasmBridge | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    initLogger(context);
    wasmBridge = new WasmBridge(context);
    await wasmBridge.initialize();

    const disposable = vscode.commands.registerCommand(
        'd2j.sendToJupyter',
        (element: DebugVariableElement) => {
            if (!wasmBridge) {
                vscode.window.showErrorMessage('D2J: Wasm module not initialized.');
                return;
            }
            handleSendToJupyter(element, wasmBridge, context);
        }
    );

    context.subscriptions.push(disposable);
}

export function deactivate(): void {
    wasmBridge = undefined;
}
