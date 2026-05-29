import * as vscode from 'vscode';

let channel: vscode.OutputChannel;

const LOG_LEVELS: Record<string, number> = {
    off: 0,
    error: 1,
    warning: 2,
    info: 3,
    debug: 4,
};

function isDebugEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('d2j');
    const level = config.get<string>('logLevel', 'info');
    return LOG_LEVELS[level] >= LOG_LEVELS['debug'];
}

export function initLogger(context: vscode.ExtensionContext): void {
    channel = vscode.window.createOutputChannel('D2J');
    context.subscriptions.push(channel);
}

export function log(msg: string): void {
    const ts = new Date().toISOString().substring(11, 23);
    channel.appendLine(`[${ts}] ${msg}`);
}

export function debug(msg: string): void {
    if (isDebugEnabled()) {
        log(`[DEBUG] ${msg}`);
    }
}

export function showOutput(): void {
    channel.show(true);
}
