import * as path from 'path';

export function sanitizeSourcePath(sourcePath: string, workspaceRoot: string): string {
    const normalizedSource = sourcePath.replace(/\\/g, '/');
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');

    const relative = path.posix.relative(normalizedRoot, normalizedSource);

    let result: string;
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        result = path.basename(sourcePath);
    } else {
        result = relative.replace(/[/\\]/g, '_');
    }

    // Strip extension
    const ext = path.posix.extname(result);
    if (ext) {
        result = result.slice(0, -ext.length);
    }

    // Replace any remaining unsafe characters
    result = result.replace(/[^a-zA-Z0-9_.-]/g, '_');

    return result;
}

export function formatTimestamp(): string {
    const now = new Date();
    const y = now.getFullYear().toString();
    const mo = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const h = now.getHours().toString().padStart(2, '0');
    const mi = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    return `${y}${mo}${d}${h}${mi}${s}`;
}
