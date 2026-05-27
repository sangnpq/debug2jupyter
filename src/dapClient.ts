import * as vscode from 'vscode';
import { D2JError } from './errors';

export async function resolveCurrentFrameId(session: vscode.DebugSession): Promise<number> {
    const threadsResponse = await session.customRequest('threads') as {
        threads?: Array<{ id: number; name: string }>;
    };
    if (!threadsResponse?.threads?.length) {
        throw new D2JError('noDebugThread', 'No threads found in debug session.');
    }

    const threadId = threadsResponse.threads[0].id;
    const stackResponse = await session.customRequest('stackTrace', { threadId, levels: 1 }) as {
        stackFrames?: Array<{ id: number }>;
    };
    if (!stackResponse?.stackFrames?.length) {
        throw new D2JError('noDebugStackFrame', 'No stack frames found in debug session.');
    }

    return stackResponse.stackFrames[0].id;
}

export async function evaluateDapExpression(
    session: vscode.DebugSession,
    expression: string,
    frameId?: number
): Promise<string> {
    const resolvedFrameId = frameId ?? await resolveCurrentFrameId(session);

    const args: { expression: string; context: string; frameId: number } = {
        expression,
        context: 'repl',
        frameId: resolvedFrameId,
    };

    const response = await session.customRequest('evaluate', args) as { result?: string };

    if (!response || response.result === undefined) {
        throw new Error(`DAP evaluate failed for expression: ${expression}`);
    }

    return response.result;
}
