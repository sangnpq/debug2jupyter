import * as vscode from 'vscode';
import { resolvePythonEnvironment, ensurePythonPackages } from './pythonEnv';
import { evaluateDapExpression } from './dapClient';
import { WasmBridge } from './wasmBridge';
import { writeAndOpenNotebook, ensureGlobalStorageDir } from './notebookWriter';
import { D2JError, showError, showWarning } from './errors';

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

    if (!varName || varName.trim() === '') {
        showError(new D2JError('invalidVariable', 'Variable name is empty.'));
        return;
    }

    if (!vscode.workspace.workspaceFolders) {
        showError(new D2JError('noWorkspace', 'No workspace folder is open.'));
        return;
    }

    const activeSession = vscode.debug.activeDebugSession;
    if (!activeSession) {
        showError(new D2JError('noDebugSession', 'No active debug session.'));
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

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

                progress.report({ message: 'Checking Python packages...' });
                await ensurePythonPackages(pyEnv.pythonPath);

                progress.report({ message: 'Ensuring storage directory...' });
                await ensureGlobalStorageDir(context.globalStorageUri);

                progress.report({ message: 'Dumping variable to pickle...' });
                const pklPath = vscode.Uri.joinPath(context.globalStorageUri, `${varName}.pkl`).fsPath;
                const escapedPklPath = pklPath.replace(/'/g, "\\'");
                const dumpExpr = `import joblib; joblib.dump(${varName}, r'${escapedPklPath}')`;
                await evaluateDapExpression(activeSession, dumpExpr);

                progress.report({ message: 'Generating notebook...' });
                const notebookJson = wasmBridge.generateNotebook(varName, pklPath, pyEnv.venvName);

                progress.report({ message: 'Writing notebook file...' });
                await writeAndOpenNotebook(notebookJson, varName, workspaceRoot);
            }
        );
    } catch (err) {
        showError(err);
    }
}
