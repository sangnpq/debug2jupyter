import * as vscode from 'vscode';
import * as path from 'path';
import { D2JError } from './errors';
import { log } from './logger';
import { WasmBridge, RankedFrame } from './wasmBridge';

export interface StackFrameInfo {
    frameId: number;
    threadId: number;
    sourcePath?: string;
    line?: number;
}

function isVirtualSourceFallback(source?: { path?: string; name?: string; sourceReference?: number }): boolean {
    if (!source) return true;
    if (source.sourceReference && source.sourceReference > 0) return true;
    if (source.path === '<string>' || source.path === '<stdin>' || source.path === '<repl>') return true;
    return false;
}

function getSourcePriorityFallback(sourcePath: string | undefined, workspaceRoot: string): number {
    if (!sourcePath) return 3;
    if (sourcePath.startsWith(workspaceRoot)) return 0;
    if (sourcePath.includes('site-packages')) return 1;
    return 2;
}

function candidatesToRankedJson(candidates: ThreadFrameInfo[]): unknown[] {
    return candidates.map(c => ({
        thread_id: c.threadId,
        thread_name: c.threadName,
        frame_id: c.frameId,
        frame_name: c.frameName,
        source_path: c.sourcePath ?? null,
        source_name: c.sourceName ?? null,
        source_ref: c.sourceRef ?? null,
        line: c.line ?? null,
        has_variable: c.hasVariable ?? null,
    }));
}

interface ThreadFrameInfo {
    threadId: number;
    threadName: string;
    frameId: number;
    frameName: string;
    sourcePath?: string;
    sourceName?: string;
    sourceRef?: number;
    line?: number;
    hasVariable?: boolean;
}

async function checkVariableInFrame(
    session: vscode.DebugSession,
    frameId: number,
    variableName: string
): Promise<boolean> {
    try {
        const scopesResp = await session.customRequest('scopes', { frameId }) as {
            scopes?: Array<{ variablesReference: number; name?: string; expensive?: boolean }>;
        };
        for (const scope of scopesResp?.scopes ?? []) {
            if (scope.expensive) continue;
            try {
                const varsResp = await session.customRequest('variables', {
                    variablesReference: scope.variablesReference,
                }) as {
                    variables?: Array<{ name: string; value: string; variablesReference: number }>;
                };
                const found = varsResp?.variables?.some(v => v.name === variableName);
                if (found) return true;
            } catch {
                // skip unreadable scope
            }
        }
    } catch {
        // skip frames we can't inspect
    }
    return false;
}

export async function resolveCurrentFrameId(
    session: vscode.DebugSession,
    preferredThreadId?: number,
    variableName?: string,
    workspaceRoot?: string,
    wasmBridge?: WasmBridge,
): Promise<StackFrameInfo> {
    log(`resolveCurrentFrameId: session=${session.id}, name=${session.name}, type=${session.type}, variableName=${variableName ?? '(none)'}`);

    const threadsResponse = await session.customRequest('threads') as {
        threads?: Array<{ id: number; name: string }>;
    };
    log(`resolveCurrentFrameId: all threads: ${JSON.stringify(threadsResponse?.threads)}`);

    if (!threadsResponse?.threads?.length) {
        throw new D2JError('noDebugThread', 'No threads found in debug session.');
    }

    const stackTracePromises = threadsResponse.threads.map(async (t) => {
        try {
            const stResp = await session.customRequest('stackTrace', { threadId: t.id, levels: 1 }) as {
                stackFrames?: Array<{ id: number; name?: string; source?: { path?: string; name?: string; sourceReference?: number }; line?: number; column?: number }>;
            };
            const topFrame = stResp?.stackFrames?.[0];
            log(`resolveCurrentFrameId: thread id=${t.id} name="${t.name}" topFrame=${topFrame ? `{id=${topFrame.id}, name="${topFrame.name}", source=${JSON.stringify(topFrame.source)}, line=${topFrame.line}}` : 'none'}`);
            if (topFrame) {
                return {
                    threadId: t.id,
                    threadName: t.name,
                    frameId: topFrame.id,
                    frameName: topFrame.name ?? '',
                    sourcePath: topFrame.source?.path,
                    sourceName: topFrame.source?.name,
                    sourceRef: topFrame.source?.sourceReference,
                    line: topFrame.line,
                } as ThreadFrameInfo;
            }
        } catch (e) {
            log(`resolveCurrentFrameId: thread id=${t.id} name="${t.name}" stackTrace failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        return undefined;
    });

    const stackResults = await Promise.all(stackTracePromises);
    const candidates: ThreadFrameInfo[] = stackResults.filter((c): c is ThreadFrameInfo => c !== undefined);

    if (!candidates.length) {
        throw new D2JError('noDebugStackFrame', 'No stack frames found in debug session.');
    }

    if (variableName) {
        log(`resolveCurrentFrameId: checking variable "${variableName}" across ${candidates.length} frames (in parallel)...`);
        const wsRoot = workspaceRoot ?? '';

        let sorted: ThreadFrameInfo[];
        if (wasmBridge) {
            const ranked = wasmBridge.rankThreadCandidates(candidatesToRankedJson(candidates), wsRoot);
            const rankedMap = new Map<number, RankedFrame>();
            for (const r of ranked) {
                rankedMap.set(r.frame_id, r);
            }
            sorted = [...candidates].sort((a, b) => {
                const ra = rankedMap.get(a.frameId);
                const rb = rankedMap.get(b.frameId);
                return (ra?.score ?? 0) - (rb?.score ?? 0);
            });
        } else {
            sorted = [...candidates].sort((a, b) => {
                const pa = getSourcePriorityFallback(a.sourcePath, wsRoot);
                const pb = getSourcePriorityFallback(b.sourcePath, wsRoot);
                if (pa !== pb) return pa - pb;
                if (a.sourcePath && b.sourcePath) {
                    const aV = isVirtualSourceFallback({ path: a.sourcePath, sourceReference: a.sourceRef }) ? 1 : 0;
                    const bV = isVirtualSourceFallback({ path: b.sourcePath, sourceReference: b.sourceRef }) ? 1 : 0;
                    if (aV !== bV) return aV - bV;
                }
                return a.threadId - b.threadId;
            });
        }

        const varCheckPromises = sorted.map(async (c) => {
            const has = await checkVariableInFrame(session, c.frameId, variableName);
            c.hasVariable = has;
            log(`resolveCurrentFrameId: variable "${variableName}" in thread id=${c.threadId} name="${c.threadName}" frameId=${c.frameId} source=${c.sourcePath}: ${has ? 'FOUND' : 'not found'}`);
            return c;
        });
        const checked = await Promise.all(varCheckPromises);

        const found = checked.find(c => c.hasVariable);
        if (found) {
            log(`resolveCurrentFrameId: found variable "${variableName}" in thread id=${found.threadId} name="${found.threadName}" frameId=${found.frameId} source=${found.sourcePath}`);
            return {
                frameId: found.frameId,
                threadId: found.threadId,
                sourcePath: found.sourcePath,
                line: found.line,
            };
        }
        log(`resolveCurrentFrameId: variable "${variableName}" not found in any frame; falling back to heuristic selection`);
    }

    const isVirtual = wasmBridge
        ? (s: { path?: string; name?: string; sourceReference?: number }) => wasmBridge.isVirtualSource(s)
        : isVirtualSourceFallback;

    const realCandidates = candidates.filter(c => !isVirtual({ path: c.sourcePath, name: c.sourceName, sourceReference: c.sourceRef }));
    const preferred = preferredThreadId !== undefined ? candidates.find(c => c.threadId === preferredThreadId) : undefined;

    let chosen: ThreadFrameInfo;
    if (preferred && !isVirtual({ path: preferred.sourcePath, name: preferred.sourceName, sourceReference: preferred.sourceRef })) {
        log(`resolveCurrentFrameId: using preferred threadId=${preferred.threadId} name="${preferred.threadName}" (real source)`);
        chosen = preferred;
    } else if (realCandidates.length > 0) {
        if (preferred) {
            log(`resolveCurrentFrameId: preferred threadId=${preferredThreadId} is virtual source, picking best real-source thread instead`);
        }
        if (wasmBridge) {
            const ranked = wasmBridge.rankThreadCandidates(candidatesToRankedJson(realCandidates), workspaceRoot ?? '');
            const best = ranked[0];
            chosen = realCandidates.find(c => c.frameId === best.frame_id)!;
        } else {
            realCandidates.sort((a, b) => {
                const pa = getSourcePriorityFallback(a.sourcePath, workspaceRoot ?? '');
                const pb = getSourcePriorityFallback(b.sourcePath, workspaceRoot ?? '');
                if (pa !== pb) return pa - pb;
                return a.threadId - b.threadId;
            });
            chosen = realCandidates[0];
        }
        log(`resolveCurrentFrameId: using real-source thread id=${chosen.threadId} name="${chosen.threadName}" source=${chosen.sourcePath}`);
    } else {
        if (preferred) {
            log(`resolveCurrentFrameId: preferred threadId=${preferredThreadId} is virtual source, no real-source threads available, falling back to preferred`);
            chosen = preferred;
        } else {
            chosen = candidates[0];
            log(`resolveCurrentFrameId: no real-source threads, using first thread id=${chosen.threadId} name="${chosen.threadName}"`);
        }
    }

    const result: StackFrameInfo = {
        frameId: chosen.frameId,
        threadId: chosen.threadId,
        sourcePath: chosen.sourcePath,
        line: chosen.line,
    };
    log(`resolveCurrentFrameId: resolved frameId=${result.frameId}, threadId=${result.threadId}, source=${result.sourcePath ?? '(no path)'}, line=${result.line}`);
    return result;
}

function isStaleFrameError(err: unknown): boolean {
    if (err instanceof Error) {
        return /unable to find thread for evaluation/i.test(err.message);
    }
    return false;
}

export async function evaluateDapExpression(
    session: vscode.DebugSession,
    expression: string,
    frameInfo?: StackFrameInfo,
    variableName?: string,
    workspaceRoot?: string,
    wasmBridge?: WasmBridge,
): Promise<string> {
    let resolved = frameInfo ?? await resolveCurrentFrameId(session, undefined, variableName, workspaceRoot, wasmBridge);

    const args: { expression: string; context: string; frameId: number } = {
        expression,
        context: 'repl',
        frameId: resolved.frameId,
    };
    log(`evaluateDapExpression: START frameId=${args.frameId}, threadId=${resolved.threadId}, source=${resolved.sourcePath ?? '(no path)'}, line=${resolved.line}, expression="${expression}"`);
    const evalStart = Date.now();

    let response: { result?: string } | undefined;
    try {
        response = await session.customRequest('evaluate', args) as { result?: string };
        log(`evaluateDapExpression: first attempt OK (${Date.now() - evalStart}ms)`);
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log(`evaluateDapExpression: first attempt FAILED after ${Date.now() - evalStart}ms: ${errMsg}`);
        if (!isStaleFrameError(err)) {
            log(`evaluateDapExpression: error is not stale-frame, re-throwing`);
            throw err;
        }

        log(`evaluateDapExpression: detected stale frame — will pause threadId=${resolved.threadId} and retry`);

        try {
            const threadsBefore = await session.customRequest('threads') as { threads?: Array<{ id: number; name: string }> };
            log(`evaluateDapExpression: threads BEFORE pause: ${JSON.stringify(threadsBefore?.threads)}`);
            for (const t of threadsBefore?.threads ?? []) {
                try {
                    const st = await session.customRequest('stackTrace', { threadId: t.id, levels: 1 }) as {
                        stackFrames?: Array<{ id: number; name?: string }>;
                    };
                    log(`evaluateDapExpression:   thread id=${t.id} name="${t.name}" topFrameId=${st?.stackFrames?.[0]?.id ?? 'none'} topFrameName="${st?.stackFrames?.[0]?.name ?? 'none'}"`);
                } catch (stErr) {
                    log(`evaluateDapExpression:   thread id=${t.id} name="${t.name}" stackTrace query failed: ${stErr instanceof Error ? stErr.message : String(stErr)}`);
                }
            }
        } catch (threadsErr) {
            log(`evaluateDapExpression: threads query before pause failed: ${threadsErr instanceof Error ? threadsErr.message : String(threadsErr)}`);
        }

        log(`evaluateDapExpression: calling pause({ threadId: ${resolved.threadId} })`);
        const pauseStart = Date.now();
        try {
            await session.customRequest('pause', { threadId: resolved.threadId });
            log(`evaluateDapExpression: pause completed for threadId=${resolved.threadId} (${Date.now() - pauseStart}ms)`);
        } catch (pauseErr) {
            log(`evaluateDapExpression: pause FAILED for threadId=${resolved.threadId}: ${pauseErr instanceof Error ? pauseErr.message : String(pauseErr)}`);
        }

        try {
            const threadsAfter = await session.customRequest('threads') as { threads?: Array<{ id: number; name: string }> };
            log(`evaluateDapExpression: threads AFTER pause: ${JSON.stringify(threadsAfter?.threads)}`);
            for (const t of threadsAfter?.threads ?? []) {
                try {
                    const st = await session.customRequest('stackTrace', { threadId: t.id, levels: 1 }) as {
                        stackFrames?: Array<{ id: number; name?: string; source?: { path?: string; name?: string; sourceReference?: number }; line?: number }>;
                    };
                    const tf = st?.stackFrames?.[0];
                    log(`evaluateDapExpression:   thread id=${t.id} name="${t.name}" frame={id=${tf?.id}, name="${tf?.name}", source=${JSON.stringify(tf?.source)}, line=${tf?.line}}`);
                } catch (stErr) {
                    log(`evaluateDapExpression:   thread id=${t.id} name="${t.name}" stackTrace query failed: ${stErr instanceof Error ? stErr.message : String(stErr)}`);
                }
            }
        } catch (threadsErr) {
            log(`evaluateDapExpression: threads query after pause failed: ${threadsErr instanceof Error ? threadsErr.message : String(threadsErr)}`);
        }

        const maxRetries = 10;
        const baseDelay = 100;
        let lastError: unknown = err;

        try {
            for (let i = 0; i < maxRetries; i++) {
                const delay = baseDelay * (i + 1);
                log(`evaluateDapExpression: retry ${i + 1}/${maxRetries} — waiting ${delay}ms then re-resolving frame`);
                await new Promise(r => setTimeout(r, delay));
                const prevFrameId = resolved.frameId;
                const isVirtual = wasmBridge
                    ? wasmBridge.isVirtualSource({ path: resolved.sourcePath, sourceReference: undefined })
                    : isVirtualSourceFallback({ path: resolved.sourcePath, sourceReference: undefined });
                const retryPreferred = isVirtual ? undefined : resolved.threadId;
                resolved = await resolveCurrentFrameId(session, retryPreferred, variableName, workspaceRoot, wasmBridge);
                const frameChanged = resolved.frameId !== prevFrameId;
                log(`evaluateDapExpression: retry ${i + 1} — frameId ${prevFrameId}→${resolved.frameId} (${frameChanged ? 'CHANGED' : 'same'}), source=${resolved.sourcePath ?? '(no path)'}, line=${resolved.line}`);

                try {
                    const retryStart = Date.now();
                    response = await session.customRequest('evaluate', {
                        expression: args.expression,
                        context: args.context,
                        frameId: resolved.frameId,
                    }) as { result?: string };
                    log(`evaluateDapExpression: retry ${i + 1} SUCCEEDED (${Date.now() - retryStart}ms)`);
                    break;
                } catch (retryErr) {
                    const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                    lastError = retryErr;
                    if (!isStaleFrameError(retryErr)) {
                        log(`evaluateDapExpression: retry ${i + 1} FAILED with non-stale error: ${retryMsg}`);
                        throw retryErr;
                    }
                    log(`evaluateDapExpression: retry ${i + 1} FAILED — still stale frame: ${retryMsg}`);
                }
            }

            if (!response) {
                log(`evaluateDapExpression: all ${maxRetries} retries exhausted, throwing last stale-frame error`);
                throw lastError;
            }
        } finally {
            log(`evaluateDapExpression: FINALLY — continuing threadId=${resolved.threadId}`);
            try {
                await session.customRequest('continue', { threadId: resolved.threadId });
                log(`evaluateDapExpression: continue OK for threadId=${resolved.threadId}`);
            } catch (e: unknown) {
                log(`evaluateDapExpression: continue FAILED for threadId=${resolved.threadId}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    if (!response || response.result === undefined) {
        throw new Error(`DAP evaluate failed for expression: ${expression}`);
    }

    log(`evaluateDapExpression: DONE — total ${Date.now() - evalStart}ms, result length=${response.result.length}`);
    return response.result;
}
