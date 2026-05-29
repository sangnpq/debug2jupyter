import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { D2JError } from './errors';

export interface PythonEnvironment {
    pythonPath: string;
    venvName: string;
    venvFolder: string;
}

export async function resolvePythonEnvironment(): Promise<PythonEnvironment | undefined> {
    const pythonExtension = vscode.extensions.getExtension('ms-python.python');
    if (!pythonExtension) {
        return undefined;
    }

    const api = pythonExtension.isActive
        ? pythonExtension.exports
        : await pythonExtension.activate();

    if (api.environments) {
        const envPath = api.environments.getActiveEnvironmentPath();
        const resolved = await api.environments.resolveEnvironment(envPath);
        if (resolved && resolved.executable.uri) {
            const pythonPath = resolved.executable.uri.fsPath;
            const venvName = resolved.environment?.name
                ?? path.basename(resolved.environment?.folderUri?.fsPath ?? 'default');
            const venvFolder = resolved.environment?.folderUri?.fsPath ?? '';
            return { pythonPath, venvName, venvFolder };
        }
    }

    if (api.settings) {
        const details = api.settings.getExecutionDetails();
        const execCommand = details.execCommand;
        if (execCommand && execCommand.length > 0) {
            const pythonPath = execCommand[0];
            const venvName = extractVenvName(pythonPath);
            const venvFolder = extractVenvFolder(pythonPath);
            return { pythonPath, venvName, venvFolder };
        }
    }

    return undefined;
}

function extractVenvName(pythonPath: string): string {
    const normalized = pythonPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const venvIndex = parts.findIndex(p => p.startsWith('.venv') || p === 'env' || p === 'venv');
    if (venvIndex >= 0) {
        return parts[venvIndex];
    }
    const binIndex = parts.lastIndexOf('bin');
    const scriptsIndex = parts.lastIndexOf('Scripts');
    const idx = Math.max(binIndex, scriptsIndex);
    if (idx > 0) {
        return parts[idx - 1];
    }
    return 'default';
}

function extractVenvFolder(pythonPath: string): string {
    const normalized = pythonPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const binIndex = parts.lastIndexOf('bin');
    const scriptsIndex = parts.lastIndexOf('Scripts');
    const idx = Math.max(binIndex, scriptsIndex);
    if (idx > 0) {
        return parts.slice(0, idx).join('/');
    }
    return path.dirname(pythonPath);
}

function execAsync(command: string, args: string[], options: { timeout: number }): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { timeout: options.timeout }, (error, stdout, stderr) => {
            if (error) { reject(error); }
            else { resolve(stdout); }
        });
    });
}

export async function ensurePythonPackages(pythonPath: string): Promise<void> {
    try {
        await execAsync(pythonPath, ['-c', 'import joblib, ipykernel'], { timeout: 10000 });
        return;
    } catch {
        // At least one is missing; install both
    }

    try {
        await execAsync(pythonPath, ['-m', 'pip', 'install', 'joblib', 'ipykernel'], { timeout: 120000 });
    } catch {
        // pip may not be available (e.g. uv-managed venv); try uv as fallback
        try {
            await execAsync('uv', ['pip', 'install', '--python', pythonPath, 'joblib', 'ipykernel'], { timeout: 120000 });
        } catch (uvInstallErr) {
            throw new D2JError('pipInstallFailed',
                `Failed to install joblib/ipykernel. Run manually: "${pythonPath}" -m pip install joblib ipykernel  OR  uv pip install --python "${pythonPath}" joblib ipykernel`
            );
        }
    }

    const venvName = extractVenvName(pythonPath);
    const kernelName = `python3_${venvName.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    try {
        await execAsync(
            pythonPath,
            ['-m', 'ipykernel', 'install', '--user', '--name=' + kernelName, '--display-name=Python 3 (' + venvName + ')'],
            { timeout: 30000 }
        );
    } catch {
        // Non-fatal; warn but proceed
    }
}

