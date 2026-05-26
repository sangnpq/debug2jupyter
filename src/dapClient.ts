import * as vscode from 'vscode';

export async function evaluateDapExpression(
    session: vscode.DebugSession,
    expression: string,
    frameId?: number
): Promise<string> {
    const args: { expression: string; context: string; frameId?: number } = {
        expression,
        context: 'repl',
    };
    if (frameId !== undefined) {
        args.frameId = frameId;
    }

    const response = await session.customRequest('evaluate', args) as { body?: { result: string } };

    if (!response || response.body === undefined) {
        throw new Error(`DAP evaluate failed for expression: ${expression}`);
    }

    return response.body.result;
}
