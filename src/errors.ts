import * as vscode from 'vscode';

export class D2JError extends Error {
    constructor(
        public readonly kind: string,
        message: string
    ) {
        super(message);
        this.name = 'D2JError';
    }
}

const ERROR_MESSAGES: Record<string, string> = {
    noWorkspace: 'No workspace is open. Please open a folder before using D2J.',
    noDebugSession: 'No active debug session. Start debugging first.',
    noDebugThread: 'No threads found in debug session. Please ensure the debugger is running.',
    noDebugStackFrame: 'No stack frames found in debug session. Please ensure the debugger is paused.',
    pythonExtNotInstalled: 'The Python extension (ms-python.python) is required. Install it from the marketplace.',
    noPythonEnv: 'Could not detect a Python environment. Select a Python interpreter.',
    pipInstallFailed: 'Failed to install required Python packages.',
    dapEvaluateFailed: 'Failed to dump variable from debug session. The variable may not support serialization.',
    dapSessionLost: 'Debug session ended while dumping the variable.',
    wasmLoadFailed: 'Failed to load the notebook generator module. Try reinstalling the extension.',
    wasmGenerateError: 'Failed to generate notebook JSON.',
    fileWriteFailed: 'Failed to write the notebook file. Check workspace folder permissions.',
    invalidVariable: 'Invalid variable selected.',
};

export function showError(err: unknown): void {
    if (err instanceof D2JError) {
        const userMessage = ERROR_MESSAGES[err.kind] ?? err.message;
        vscode.window.showErrorMessage(`D2J: ${userMessage}`);
    } else if (err instanceof Error) {
        vscode.window.showErrorMessage(`D2J: ${err.message}`);
    } else {
        vscode.window.showErrorMessage('D2J: An unexpected error occurred.');
    }
}

export function showWarning(message: string): void {
    vscode.window.showWarningMessage(`D2J: ${message}`);
}
