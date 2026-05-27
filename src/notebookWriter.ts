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

    const doc = await vscode.workspace.openNotebookDocument(uri);
    await vscode.window.showNotebookDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
    });

    const codeCell = doc.getCells().find((c: vscode.NotebookCell) => c.kind === vscode.NotebookCellKind.Code);
    if (codeCell) {
        await vscode.commands.executeCommand('notebook.cell.execute', {
            document: doc,
            cells: [codeCell.index],
        });
    }

    vscode.window.showInformationMessage(`Notebook created: D2J_${varName}.ipynb`);
}

export async function ensureGlobalStorageDir(globalStorageUri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.createDirectory(globalStorageUri);
    } catch {
        // Directory may already exist
    }
}
