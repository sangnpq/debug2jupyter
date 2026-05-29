import * as vscode from 'vscode';

let channel: vscode.OutputChannel;

export function initLogger(context: vscode.ExtensionContext): void {
    channel = vscode.window.createOutputChannel('D2J');
    context.subscriptions.push(channel);
}

export function log(msg: string): void {
    const ts = new Date().toISOString().substring(11, 23);
    channel.appendLine(`[${ts}] ${msg}`);
}

export function showOutput(): void {
    channel.show(true);
}
