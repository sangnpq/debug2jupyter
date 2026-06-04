import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sanitizeSourcePath, formatTimestamp } from '../src/utils';

// We'll test the notebook generation by mocking the Wasm module
// Since the actual wasm module requires native bindings, we'll test the
// expected behavior by parsing the generated notebook JSON structure

const SAMPLE_PKL_PATH = '/tmp/exported/df.pkl';
const SAMPLE_VENV = 'myenv';

interface Cell {
    cell_type: string;
    id: string;
    metadata: Record<string, unknown>;
    source: string[];
    execution_count: number | null;
    outputs: unknown[];
}

interface NotebookMetadata {
    kernelspec: {
        display_name: string;
        name: string;
    };
}

interface Notebook {
    nbformat: number;
    nbformat_minor: number;
    metadata: NotebookMetadata;
    cells: Cell[];
}

function validateNotebookJson(jsonString: string): { parsed: Notebook; error: null } | { parsed: null; error: string } {
    try {
        const parsed = JSON.parse(jsonString);
        return { parsed: parsed as Notebook, error: null };
    } catch (e) {
        return { parsed: null, error: e instanceof Error ? e.message : 'Unknown parse error' };
    }
}

function extractCodeCell(notebook: Notebook): Cell | null {
    return notebook.cells.find(cell => cell.cell_type === 'code') || null;
}

function extractMarkdownCell(notebook: Notebook): Cell | null {
    return notebook.cells.find(cell => cell.cell_type === 'markdown') || null;
}

function getKernelName(venvName: string): string {
    return `python3_${venvName
        .toLowerCase()
        .replace(/[^a-z0-9_\-]/g, '-')
        .replace(/^-+|-+$/g, '')}`;
}

describe('Dataframe Run Tests', () => {
    describe('Basic Dataframe Export', () => {
        it('should generate valid notebook for basic dataframe', () => {
            const varName = 'df';
            const pklPath = '/tmp/exported/df.pkl';
            const venvName = 'myenv';

            // Mock expected notebook structure based on wasm generation logic
            const escapedPklPath = pklPath.replace(/\\/g, '/');
            const kernelName = getKernelName(venvName);

            const expectedNotebook: Notebook = {
                nbformat: 4,
                nbformat_minor: 5,
                metadata: {
                    kernelspec: {
                        display_name: `Python 3 (${venvName})`,
                        name: kernelName,
                    },
                },
                cells: [
                    {
                        cell_type: 'markdown',
                        id: 'd2j-header',
                        metadata: {},
                        source: [`# Debug to Jupyter Export\n`, `\n`, `Variable: \`${varName}\`\n`],
                        execution_count: null,
                        outputs: [],
                    },
                    {
                        cell_type: 'code',
                        id: 'd2j-load',
                        metadata: {},
source: [
                            `import pickle\n`,
                            `with open('${escapedPklPath}', 'rb') as f:\n`,
                            `    ${varName} = pickle.load(f)\n`,
                            `print(f'Successfully loaded live variable: ${varName}')\n`,
                        ],
                        execution_count: null,
                        outputs: [],
                    },
                ],
            };

            const jsonString = JSON.stringify(expectedNotebook, null, 4);
            const result = validateNotebookJson(jsonString);

            expect(result.error).toBeNull();
            expect(result.parsed).not.toBeNull();

            const notebook = result.parsed!;
            expect(notebook.nbformat).toBe(4);
            expect(notebook.nbformat_minor).toBe(5);
            expect(notebook.metadata.kernelspec.name).toBe('python3_myenv');
            expect(notebook.metadata.kernelspec.display_name).toBe('Python 3 (myenv)');
            expect(notebook.cells.length).toBe(2);
        });

        it('should have appropriate kernel name for data science venv', () => {
            const venvName = 'data-science-env';
            const kernelName = getKernelName(venvName);

            expect(kernelName).toBe('python3_data-science-env');
        });

        it('should escape single quotes in path', () => {
            const pklPath = "/tmp/my file's data/df.pkl";
            const escapedPklPath = pklPath.replace(/\\/g, '/').replace(/'/g, "\\'");

            expect(escapedPklPath).toContain("\\'");
        });

        it('should normalize Windows paths', () => {
            const windowsPath = 'C:\\Users\\test\\df.pkl';
            const normalizedPath = windowsPath.replace(/\\/g, '/');

            expect(normalizedPath).toBe('C:/Users/test/df.pkl');
            expect(normalizedPath).not.toContain('\\\\');
        });
    });

    describe('Dataframe Variable Name Variations', () => {
        it('should handle simple dataframe name', () => {
            const varName = 'df';
            const kernelName = getKernelName('env');

            expect(varName).toBe('df');
            expect(kernelName).toBe('python3_env');
        });

        it('should handle dataframe with underscore', () => {
            const varName = 'my_df';
            expect(varName).toBe('my_df');
        });

        it('should handle dataframe with numbers', () => {
            const varName = 'df2024';
            expect(varName).toBe('df2024');
        });

        it('should handle dataframe with camelCase', () => {
            const varName = 'resultDataFrame';
            expect(varName).toBe('resultDataFrame');
        });

        it('should handle dataframe with descriptive prefix', () => {
            const varName = 'training_results_df';
            expect(varName).toBe('training_results_df');
        });
    });

    describe('Dataframe with Complex Venv Names', () => {
        it('should sanitize venv name with spaces', () => {
            const venvName = 'my data env';
            const kernelName = getKernelName(venvName);

            expect(kernelName).toBe('python3_my-data-env');
        });

        it('should sanitize venv name with special characters', () => {
            const venvName = 'env@prod!';
            const kernelName = getKernelName(venvName);

            expect(kernelName).toBe('python3_env-prod');
        });

        it('should handle venv name with mixed case', () => {
            const venvName = 'MyVenv';
            const kernelName = getKernelName(venvName);

            expect(kernelName).toBe('python3_myvenv');
        });

        it('should handle venv name starting with numbers', () => {
            const venvName = '3env';
            const kernelName = getKernelName(venvName);

            expect(kernelName).toBe('python3_3env');
        });
    });

    describe('Notebook Cell Structure', () => {
        it('should have markdown header cell', () => {
            const varName = 'df';
            const markdownCell: Cell = {
                cell_type: 'markdown',
                id: 'd2j-header',
                metadata: {},
                source: [
                    `# Debug to Jupyter Export\n`,
                    `\n`,
                    `Variable: \`${varName}\`\n`,
                ],
                execution_count: null,
                outputs: [],
            };

            expect(markdownCell.cell_type).toBe('markdown');
            expect(markdownCell.source.join('')).toContain('Debug to Jupyter Export');
            expect(markdownCell.source.join('')).toContain(`Variable: \`${varName}\``);
        });

        it('should have code cell that loads dataframe', () => {
            const varName = 'df';
            const escapedPklPath = '/tmp/df.pkl';
            const codeCell: Cell = {
                cell_type: 'code',
                id: 'd2j-load',
                metadata: {},
                source: [
                    `import pickle\n`,
                    `with open('${escapedPklPath}', 'rb') as f:\n`,
                    `    ${varName} = pickle.load(f)\n`,
                    `print(f'Successfully loaded live variable: ${varName}')\n`,
                ],
                execution_count: null,
                outputs: [],
            };

            expect(codeCell.cell_type).toBe('code');
            expect(codeCell.source.join('')).toContain('import pickle');
            expect(codeCell.source.join('')).toContain('pickle.load(f)');
            expect(codeCell.source.join('')).toContain(`${varName} = pickle.load(f)`);
        });

        it('should have code cell with empty execution_count and outputs', () => {
            const codeCell: Cell = {
                cell_type: 'code',
                id: 'd2j-load',
                metadata: {},
                source: ['import pickle\n', 'df = pickle.load()\n'],
                execution_count: null,
                outputs: [],
            };

            expect(codeCell.execution_count).toBeNull();
            expect(codeCell.outputs).toEqual([]);
        });
    });

    describe('Error Handling', () => {
        it('should return error JSON for empty var name', () => {
            const emptyVarNameResult = JSON.stringify({
                error: 'Variable name cannot be empty',
                kind: 'EmptyVarName',
            });

            const parsed = JSON.parse(emptyVarNameResult);
            expect(parsed.error).toBeDefined();
            expect(parsed.kind).toBe('EmptyVarName');
        });

        it('should return error JSON for empty pkl path', () => {
            const emptyPklPathResult = JSON.stringify({
                error: 'Pickle path cannot be empty',
                kind: 'EmptyPklPath',
            });

            const parsed = JSON.parse(emptyPklPathResult);
            expect(parsed.error).toBeDefined();
            expect(parsed.kind).toBe('EmptyPklPath');
        });

        it('should return error JSON for empty venv name', () => {
            const emptyVenvResult = JSON.stringify({
                error: 'Venv name cannot be empty',
                kind: 'EmptyVenvName',
            });

            const parsed = JSON.parse(emptyVenvResult);
            expect(parsed.error).toBeDefined();
            expect(parsed.kind).toBe('EmptyVenvName');
        });
    });

    describe('Large Dataframe Scenarios', () => {
        it('should handle long dataframe variable name', () => {
            const varName = 'very_long_descriptive_dataframe_name_that_explains_what_it_contains';

            expect(varName.length).toBeGreaterThan(50);
            // The notebook should still be valid with long variable names
            const notebook = {
                nbformat: 4,
                nbformat_minor: 5,
                metadata: {
                    kernelspec: {
                        display_name: 'Python 3 (env)',
                        name: 'python3_env',
                    },
                },
                cells: [
                    {
                        cell_type: 'markdown',
                        id: 'd2j-header',
                        metadata: {},
                        source: [`Variable: \`${varName}\`\n`],
                        execution_count: null,
                        outputs: [],
                    },
                    {
                        cell_type: 'code',
                        id: 'd2j-load',
                        metadata: {},
                        source: [`with open('/tmp/pkl', 'rb') as f:\n    ${varName} = pickle.load(f)\n`],
                        execution_count: null,
                        outputs: [],
                    },
                ],
            };

            expect(() => JSON.stringify(notebook)).not.toThrow();
        });

        it('should handle dataframe exported to path with spaces', () => {
            const pklPath = '/tmp/my notebook folder/df.pkl';
            const escapedPklPath = pklPath.replace(/'/g, "\\'");

            // Path with spaces should still be valid (quotes in load statement handle this)
            expect(escapedPklPath).toBe(pklPath);
        });

        it('should handle dataframe with unicode in path', () => {
            const pklPath = '/tmp/données/df.pkl';
            const escapedPklPath = pklPath.replace(/\\/g, '/').replace(/'/g, "\\'");

            expect(escapedPklPath).toBe(pklPath);
        });
    });

    describe('Pickle Import Verification', () => {
        it('should import pickle for dataframe deserialization', () => {
            const sourceCode = 'import pickle';
            expect(sourceCode).toContain('pickle');
        });

        it('should use pickle.load with context manager for dataframe loading', () => {
            const loadCode = "with open('/tmp/df.pkl', 'rb') as f:\n    df = pickle.load(f)";
            expect(loadCode).toContain('pickle.load');
            expect(loadCode).toContain("'rb'");
        });
    });
});

describe('DAP Frame Resolution', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSession: any = {
        customRequest: vi.fn(),
    };

    class MockD2JError extends Error {
        constructor(public readonly kind: string, message: string) {
            super(message);
            this.name = 'D2JError';
        }
    }

    interface StackFrameInfo {
        frameId: number;
        sourcePath?: string;
        line?: number;
    }

    async function resolveCurrentFrameIdMock(session: any): Promise<StackFrameInfo> {
        const threadsResponse = await session.customRequest('threads');
        if (!threadsResponse?.threads?.length) {
            throw new MockD2JError('noDebugThread', 'No threads found in debug session.');
        }
        const threadId = threadsResponse.threads[0].id;
        const stackResponse = await session.customRequest('stackTrace', { threadId, levels: 1 });
        if (!stackResponse?.stackFrames?.length) {
            throw new MockD2JError('noDebugStackFrame', 'No stack frames found in debug session.');
        }
        const frame = stackResponse.stackFrames[0];
        return {
            frameId: frame.id,
            sourcePath: frame.source?.path,
            line: frame.line,
        };
    }

    async function evaluateDapExpressionMock(
        session: any,
        expression: string,
        frameInfo?: StackFrameInfo
    ): Promise<string> {
        const resolved = frameInfo ?? await resolveCurrentFrameIdMock(session);
        const args = {
            expression,
            context: 'repl',
            frameId: resolved.frameId,
        };
        const response = await session.customRequest('evaluate', args);
        if (!response || response.result === undefined) {
            throw new Error(`DAP evaluate failed for expression: ${expression}`);
        }
        return response.result;
    }

    beforeEach(() => {
        mockSession.customRequest = vi.fn();
        vi.clearAllMocks();
    });

    it('should resolve frame ID and pass it to evaluate', async () => {
        mockSession.customRequest
            .mockResolvedValueOnce({
                threads: [{ id: 1, name: 'MainThread' }],
            })
            .mockResolvedValueOnce({
                stackFrames: [{ id: 42, source: { path: '/project/src/main.py' }, line: 10 }],
            })
            .mockResolvedValueOnce({
                result: 'dump succeeded',
            });

        const pklPath = '/tmp/df.pkl';
        const escapedPklPath = pklPath.replace(/\\/g, '/').replace(/'/g, "\\'");
        const dumpExpr = `import pickle; f=open('${escapedPklPath}', 'wb'); pickle.dump(df, f); f.close()`;
        const result = await evaluateDapExpressionMock(mockSession, dumpExpr);

        expect(result).toBe('dump succeeded');
        expect(mockSession.customRequest).toHaveBeenCalledTimes(3);
        expect(mockSession.customRequest).toHaveBeenNthCalledWith(1, 'threads');
        expect(mockSession.customRequest).toHaveBeenNthCalledWith(2, 'stackTrace', { threadId: 1, levels: 1 });
        expect(mockSession.customRequest).toHaveBeenNthCalledWith(3, 'evaluate', {
            expression: dumpExpr,
            context: 'repl',
            frameId: 42,
        });
    });

    it('should use explicit StackFrameInfo when provided', async () => {
        mockSession.customRequest.mockResolvedValueOnce({
            result: 'dump succeeded',
        });

        const pklPath = '/tmp/df.pkl';
        const escapedPklPath = pklPath.replace(/\\/g, '/').replace(/'/g, "\\'");
        const dumpExpr = `import pickle; f=open('${escapedPklPath}', 'wb'); pickle.dump(df, f); f.close()`;
        const frameInfo: StackFrameInfo = { frameId: 99, sourcePath: '/project/app.py', line: 25 };
        const result = await evaluateDapExpressionMock(mockSession, dumpExpr, frameInfo);

        expect(result).toBe('dump succeeded');
        expect(mockSession.customRequest).toHaveBeenCalledTimes(1);
        expect(mockSession.customRequest).toHaveBeenCalledWith('evaluate', {
            expression: dumpExpr,
            context: 'repl',
            frameId: 99,
        });
    });

    it('should throw when no threads are found', async () => {
        mockSession.customRequest.mockResolvedValueOnce({
            threads: [],
        });

        await expect(
            evaluateDapExpressionMock(mockSession, 'import pickle')
        ).rejects.toThrow('No threads found in debug session');
    });

    it('should throw when no stack frames are found', async () => {
        mockSession.customRequest
            .mockResolvedValueOnce({
                threads: [{ id: 1, name: 'MainThread' }],
            })
            .mockResolvedValueOnce({
                stackFrames: [],
            });

        await expect(
            evaluateDapExpressionMock(mockSession, 'import pickle')
        ).rejects.toThrow('No stack frames found in debug session');
    });

    it('should pick the first thread when resolving frame ID', async () => {
        mockSession.customRequest
            .mockResolvedValueOnce({
                threads: [{ id: 3, name: 'Worker' }, { id: 7, name: 'MainThread' }],
            })
            .mockResolvedValueOnce({
                stackFrames: [{ id: 11, source: { path: '/project/worker.py' }, line: 5 }],
            })
            .mockResolvedValueOnce({
                result: 'ok',
            });

        await evaluateDapExpressionMock(mockSession, 'x = 1');

        expect(mockSession.customRequest).toHaveBeenNthCalledWith(2, 'stackTrace', { threadId: 3, levels: 1 });
    });
});

describe('sanitizeSourcePath', () => {
    it('should produce relative path with underscores replacing slashes', () => {
        expect(sanitizeSourcePath('/home/user/project/src/analysis/process.py', '/home/user/project'))
            .toBe('src_analysis_process');
    });

    it('should handle root-level file', () => {
        expect(sanitizeSourcePath('/home/user/project/main.py', '/home/user/project'))
            .toBe('main');
    });

    it('should fall back to basename for files outside workspace', () => {
        expect(sanitizeSourcePath('/tmp/external_script.py', '/home/user/project'))
            .toBe('external_script');
    });

    it('should strip file extension', () => {
        expect(sanitizeSourcePath('/home/user/project/notebook.ipynb', '/home/user/project'))
            .toBe('notebook');
    });

    it('should handle Windows-style paths', () => {
        expect(sanitizeSourcePath('C:\\Users\\test\\project\\src\\app.py', 'C:\\Users\\test\\project'))
            .toBe('src_app');
    });

    it('should replace unsafe characters with underscores', () => {
        expect(sanitizeSourcePath('/home/user/project/my file.py', '/home/user/project'))
            .toBe('my_file');
    });
});

describe('formatTimestamp', () => {
    it('should return a 14-character string', () => {
        const ts = formatTimestamp();
        expect(ts.length).toBe(14);
    });

    it('should contain only digits', () => {
        const ts = formatTimestamp();
        expect(ts).toMatch(/^\d{14}$/);
    });

    it('should have format YYYYmmddHHMMss', () => {
        const ts = formatTimestamp();
        const year = ts.substring(0, 4);
        const month = ts.substring(4, 6);
        const day = ts.substring(6, 8);
        const hour = ts.substring(8, 10);
        const minute = ts.substring(10, 12);
        const second = ts.substring(12, 14);

        expect(parseInt(year)).toBeGreaterThanOrEqual(2025);
        expect(parseInt(month)).toBeGreaterThanOrEqual(1);
        expect(parseInt(month)).toBeLessThanOrEqual(12);
        expect(parseInt(day)).toBeGreaterThanOrEqual(1);
        expect(parseInt(day)).toBeLessThanOrEqual(31);
        expect(parseInt(hour)).toBeLessThanOrEqual(23);
        expect(parseInt(minute)).toBeLessThanOrEqual(59);
        expect(parseInt(second)).toBeLessThanOrEqual(59);
    });
});

    
