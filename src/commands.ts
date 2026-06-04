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
    session: vscode.DebugSession;
}

export async function handleSendToJupyter(
    element: DebugVariableElement,
    wasmBridge: WasmBridge,
    context: vscode.ExtensionContext
): Promise<void> {
    const varName = element.variable.evaluateName ?? element.variable.name;
    debug(`handleSendToJupyter: varName="${varName}", variablesReference=${element.variable.variablesReference}`);

    if (!varName || varName.trim() === '') {
        showError(new D2JError('invalidVariable', 'Variable name is empty.'));
        return;
    }

    if (!vscode.workspace.workspaceFolders) {
        showError(new D2JError('noWorkspace', 'No workspace folder is open.'));
        return;
    }

    const activeSession = vscode.debug.activeDebugSession;
    debug(`handleSendToJupyter: activeSession=${activeSession ? `${activeSession.id} (${activeSession.name}, type=${activeSession.type})` : 'null'}`);
    if (!activeSession) {
        showError(new D2JError('noDebugSession', 'No active debug session.'));
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    debug(`handleSendToJupyter: workspaceRoot=${workspaceRoot}`);

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
                const timestamp = wasmBridge.formatTimestamp();
                debug(`handleSendToJupyter: frame resolved (frameId=${frameInfo.frameId}), about to evaluate dump expression`);

                progress.report({ message: 'Dumping variable to pickle...' });
                const storeDir = path.join(workspaceRoot, '.d2j_store');
                await fs.promises.mkdir(storeDir, { recursive: true });
                const pklFileName = `${wasmBridge.sanitizeSourcePath(frameInfo.sourcePath ?? 'unknown', workspaceRoot)}_${frameInfo.line ?? 0}_${varName}_${timestamp}.pkl`;
                const pklPath = path.join(storeDir, pklFileName);
                const escapedPklPath = pklPath.replace(/'/g, "\\'");
                const dumpExpr = `import pickle; f=open('${escapedPklPath}', 'wb'); pickle.dump(${varName}, f); f.close()`;
                debug(`handleSendToJupyter: evaluating dumpExpr="${dumpExpr}"`);
                await evaluateDapExpression(activeSession, dumpExpr, frameInfo, varName, workspaceRoot, wasmBridge);
                debug(`handleSendToJupyter: dump succeeded, pklPath=${pklPath}`);

                progress.report({ message: 'Generating notebook...' });
                const notebookJson = wasmBridge.generateNotebook(varName, pklPath, pyEnv.venvName);

                progress.report({ message: 'Writing notebook file...' });
                const notebookFileName = `${wasmBridge.sanitizeSourcePath(frameInfo.sourcePath ?? 'unknown', workspaceRoot)}_${timestamp}.ipynb`;
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
