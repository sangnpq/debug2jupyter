import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { resolvePythonEnvironment, ensurePythonPackages } from './pythonEnv';
import { evaluateDapExpression, resolveCurrentFrameId } from './dapClient';
import { WasmBridge } from './wasmBridge';
import { writeAndOpenNotebook } from './notebookWriter';
import { D2JError, showError } from './errors';
import { log, debug, showOutput } from './logger';

export interface DebugVariableElement {
    variable: {
        name: string;
        value: string;
        variablesReference: number;
        evaluateName?: string;
    };
}

export async function handleSendToJupyter(
    element: DebugVariableElement,
    wasmBridge: WasmBridge,
    context: vscode.ExtensionContext,
): Promise<void> {
    const activeSession = vscode.debug.activeDebugSession;
    console.log('[commands] handleSendToJupyter START', JSON.stringify({ 
        name: element.variable.name, 
        activeDebugSession: activeSession?.id,
        activeDebugSessionExists: !!vscode.debug.activeDebugSession
    }));
    if (!activeSession) {
        vscode.window.showErrorMessage('D2J: No active debug session. Start debugging first.');
        return;
    }
    const varName = element.variable.name;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    console.log(`[commands] activeSession=${activeSession?.id}, varName=${varName}, workspaceRoot=${workspaceRoot}`);
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'D2J: Exporting variable to Jupyter',
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: 'Resolving Python environment...' });
                const pyEnv = await resolvePythonEnvironment();
                if (!pyEnv) {
                    throw new D2JError('noPythonEnv', 'Could not resolve Python environment.');
                }
                debug(`handleSendToJupyter: pyEnv resolved: pythonPath=${pyEnv.pythonPath}, venvName=${pyEnv.venvName}`);

                progress.report({ message: 'Checking Python packages...' });
                await ensurePythonPackages(pyEnv.pythonPath);
                debug(`handleSendToJupyter: packages ensured`);

                progress.report({ message: 'Resolving debug context...' });
                const frameInfo = await resolveCurrentFrameId(activeSession, undefined, varName, workspaceRoot, wasmBridge);
                const timestamp = await wasmBridge.formatTimestamp();
                debug(`handleSendToJupyter: frame resolved (frameId=${frameInfo.frameId}), about to evaluate dump expression`);

                progress.report({ message: 'Dumping variable to pickle...' });
                const storeDir = path.join(workspaceRoot, '.d2j_store');
                await fs.promises.mkdir(storeDir, { recursive: true });
                const pklFileName = `${await wasmBridge.sanitizeSourcePath(frameInfo.sourcePath ?? 'unknown', workspaceRoot)}_${frameInfo.line ?? 0}_${varName}_${timestamp}.pkl`;
                const pklPath = path.join(storeDir, pklFileName);
                const escapedPklPath = pklPath.replace(/'/g, "\\'");

                // 💡 CRITICAL FIX: Array-join structure ensures clean, multiline Python formatting without compound semicolon runtime issues
                const dumpScript = [
                    `import pickle`,
                    `import types`,
                    `import io`,
                    `class D2JSafePickler(pickle.Pickler):`,
                    `    def reducer_override(self, obj):`,
                    `        if isinstance(obj, (types.FunctionType, types.LambdaType, types.MethodType)):`,
                    `            qualname = getattr(obj, '__qualname__', '')`,
                    `            if '<locals>' in qualname or not hasattr(obj, '__module__'):`,
                    `                return (str, (f"<D2J_STRIPPED_CLOSURE: {qualname}>",))`,
                    `        try:`,
                    `            return NotImplemented`,
                    `        except Exception:`,
                    `            return (str, (f"<D2J_UNPICKLABLE_OBJECT: {type(obj).__name__}>",))`,
                    `try:`,
                    `    with open('${escapedPklPath}', 'wb') as f:`,
                    `        pickler = D2JSafePickler(f, protocol=pickle.HIGHEST_PROTOCOL)`,
                    `        pickler.dump(${varName})`,
                    `    print("D2J_SUCCESS")`,
                    `except Exception as e:`,
                    `    with open('${escapedPklPath}', 'wb') as f:`,
                    `        pickle.dump(f"<D2J_SERIALIZATION_FAILURE: {str(e)}>", f)`,
                    `    print("D2J_FALLBACK")`
                ].join('\n');

                debug(`handleSendToJupyter: evaluating dumpScript="${dumpScript.replace(/\n/g, '\\n')}"`);
                console.log(`[commands] BEFORE evaluateDapExpression`);
                await evaluateDapExpression(activeSession, dumpScript, frameInfo, varName, workspaceRoot, wasmBridge);
                console.log(`[commands] AFTER evaluateDapExpression`);
                debug(`handleSendToJupyter: dump succeeded, pklPath=${pklPath}`);

                progress.report({ message: 'Generating notebook...' });
                console.log(`[commands] generateNotebook START: varName=${varName}, pklPath=${pklPath}, venvName=${pyEnv.venvName}`);
                const notebookJson = await wasmBridge.generateNotebook(varName, pklPath, pyEnv.venvName);
                console.log(`[commands] generateNotebook DONE, json len=${notebookJson.length}`);

                progress.report({ message: 'Writing notebook file...' });
                const notebookFileName = `${await wasmBridge.sanitizeSourcePath(frameInfo.sourcePath ?? 'unknown', workspaceRoot)}_${timestamp}.ipynb`;
                const notebookPath = path.join(storeDir, notebookFileName);
                await writeAndOpenNotebook(notebookJson, notebookPath);
                debug(`handleSendToJupyter: notebook written to ${notebookPath}`);
            }
        );
    } catch (err) {
        debug(`handleSendToJupyter: caught error: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
        showOutput();
        showError(err);
    }
}