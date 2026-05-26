import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function writeAndOpenNotebook(
    notebookJson: string,
    varName: string,
    workspaceRoot: string
): Promise<void> {
    const notebookPath = path.join(workspaceRoot, `D2J_${varName}.ipynb`);

    await fs.promises.writeFile(notebookPath, notebookJson, 'utf-8');

    const uri = vscode.Uri.file(notebookPath);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook');

    vscode.window.showInformationMessage(`Notebook created: D2J_${varName}.ipynb`);
}

export async function ensureGlobalStorageDir(globalStorageUri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.createDirectory(globalStorageUri);
    } catch {
        // Directory may already exist
    }
}
