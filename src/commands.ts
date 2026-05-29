import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { resolvePythonEnvironment, ensurePythonPackages } from './pythonEnv';
import { evaluateDapExpression, resolveCurrentFrameId } from './dapClient';
import { WasmBridge } from './wasmBridge';
import { writeAndOpenNotebook } from './notebookWriter';
import { D2JError, showError } from './errors';
import { sanitizeSourcePath, formatTimestamp } from './pathUtils';
import { log, showOutput } from './logger';

export interface DebugVariableElement {
    variable: {
        name: string;
        value: string;
        variablesReference: number;
    };
    session: vscode.DebugSession;
}

export async function handleSendToJupyter(
    element: DebugVariableElement,
    wasmBridge: WasmBridge,
    context: vscode.ExtensionContext
): Promise<void> {
    const varName = element.variable.name;
    log(`handleSendToJupyter: varName="${varName}", variablesReference=${element.variable.variablesReference}`);

    if (!varName || varName.trim() === '') {
        showError(new D2JError('invalidVariable', 'Variable name is empty.'));
        return;
    }

    if (!vscode.workspace.workspaceFolders) {
        showError(new D2JError('noWorkspace', 'No workspace folder is open.'));
        return;
    }

    const activeSession = vscode.debug.activeDebugSession;
    log(`handleSendToJupyter: activeSession=${activeSession ? `${activeSession.id} (${activeSession.name}, type=${activeSession.type})` : 'null'}`);
    if (!activeSession) {
        showError(new D2JError('noDebugSession', 'No active debug session.'));
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    log(`handleSendToJupyter: workspaceRoot=${workspaceRoot}`);

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
                log(`handleSendToJupyter: pyEnv resolved: pythonPath=${pyEnv.pythonPath}, venvName=${pyEnv.venvName}`);

                progress.report({ message: 'Checking Python packages...' });
                await ensurePythonPackages(pyEnv.pythonPath);
                log(`handleSendToJupyter: packages ensured`);

                progress.report({ message: 'Resolving debug context...' });
                const frameInfo = await resolveCurrentFrameId(activeSession, undefined, varName, workspaceRoot);
                const timestamp = formatTimestamp();
                log(`handleSendToJupyter: frame resolved (frameId=${frameInfo.frameId}), about to evaluate dump expression`);

                progress.report({ message: 'Dumping variable to pickle...' });
                const tmpDir = path.join(workspaceRoot, '.vscode', 'tmp');
                await fs.promises.mkdir(tmpDir, { recursive: true });
                const pklFileName = `${sanitizeSourcePath(frameInfo.sourcePath ?? 'unknown', workspaceRoot)}_${frameInfo.line ?? 0}_${varName}_${timestamp}.pkl`;
                const pklPath = path.join(tmpDir, pklFileName);
                const escapedPklPath = pklPath.replace(/'/g, "\\'");
                const dumpExpr = `import joblib; joblib.dump(${varName}, r'${escapedPklPath}')`;
                log(`handleSendToJupyter: evaluating dumpExpr="${dumpExpr}"`);
                await evaluateDapExpression(activeSession, dumpExpr, frameInfo, varName, workspaceRoot);
                log(`handleSendToJupyter: dump succeeded, pklPath=${pklPath}`);

                progress.report({ message: 'Generating notebook...' });
                const notebookJson = wasmBridge.generateNotebook(varName, pklPath, pyEnv.venvName);

                progress.report({ message: 'Writing notebook file...' });
                const scriptsDir = path.join(workspaceRoot, '.vscode', 'scripts');
                await fs.promises.mkdir(scriptsDir, { recursive: true });
                const notebookFileName = `${sanitizeSourcePath(frameInfo.sourcePath ?? 'unknown', workspaceRoot)}_${timestamp}.ipynb`;
                const notebookPath = path.join(scriptsDir, notebookFileName);
                await writeAndOpenNotebook(notebookJson, notebookPath);
                log(`handleSendToJupyter: notebook written to ${notebookPath}`);
            }
        );
    } catch (err) {
        log(`handleSendToJupyter: caught error: ${err instanceof Error ? `${err.message}\n${err.stack}` : String(err)}`);
        showOutput();
        showError(err);
    }
}
