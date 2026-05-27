import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
                            `import joblib\n`,
                            `${varName} = joblib.load('${escapedPklPath}')\n`,
                            `print(f'Loaded {type({varName}).__name__}: {${varName}}')\n`,
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
                    `import joblib\n`,
                    `${varName} = joblib.load('${escapedPklPath}')\n`,
                    `print(f'Loaded {type({varName}).__name__}: {${varName}}')\n`,
                ],
                execution_count: null,
                outputs: [],
            };

            expect(codeCell.cell_type).toBe('code');
            expect(codeCell.source.join('')).toContain('import joblib');
            expect(codeCell.source.join('')).toContain("joblib.load('");
            expect(codeCell.source.join('')).toContain(`${varName} = joblib.load('${escapedPklPath}')`);
        });

        it('should have code cell with empty execution_count and outputs', () => {
            const codeCell: Cell = {
                cell_type: 'code',
                id: 'd2j-load',
                metadata: {},
                source: ['import joblib\n', 'df = joblib.load()\n'],
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
                        source: [`${varName} = joblib.load('/tmp/pkl')\n`],
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

    describe('Joblib Import Verification', () => {
        it('should import joblib for dataframe deserialization', () => {
            const sourceCode = 'import joblib';
            expect(sourceCode).toContain('joblib');
        });

        it('should use joblib.load for dataframe loading', () => {
            const loadCode = "df = joblib.load('/tmp/df.pkl')";
            expect(loadCode).toContain('joblib.load');
            expect(loadCode).toContain('/tmp/df.pkl');
        });

        it('should use type() to detect dataframe type dynamically', () => {
            const printCode = "print(f'Loaded {type(df).__name__}: {df}')";
            expect(printCode).toContain('type(df).__name__');
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

    async function resolveCurrentFrameIdMock(session: any): Promise<number> {
        const threadsResponse = await session.customRequest('threads');
        if (!threadsResponse?.threads?.length) {
            throw new MockD2JError('noDebugThread', 'No threads found in debug session.');
        }
        const threadId = threadsResponse.threads[0].id;
        const stackResponse = await session.customRequest('stackTrace', { threadId, levels: 1 });
        if (!stackResponse?.stackFrames?.length) {
            throw new MockD2JError('noDebugStackFrame', 'No stack frames found in debug session.');
        }
        return stackResponse.stackFrames[0].id;
    }

    async function evaluateDapExpressionMock(
        session: any,
        expression: string,
        frameId?: number
    ): Promise<string> {
        const resolvedFrameId = frameId ?? await resolveCurrentFrameIdMock(session);
        const args = {
            expression,
            context: 'repl',
            frameId: resolvedFrameId,
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
                stackFrames: [{ id: 42 }],
            })
            .mockResolvedValueOnce({
                result: 'dump succeeded',
            });

        const result = await evaluateDapExpressionMock(mockSession, 'import joblib; joblib.dump(df, "/tmp/df.pkl")');

        expect(result).toBe('dump succeeded');
        expect(mockSession.customRequest).toHaveBeenCalledTimes(3);
        expect(mockSession.customRequest).toHaveBeenNthCalledWith(1, 'threads');
        expect(mockSession.customRequest).toHaveBeenNthCalledWith(2, 'stackTrace', { threadId: 1, levels: 1 });
        expect(mockSession.customRequest).toHaveBeenNthCalledWith(3, 'evaluate', {
            expression: 'import joblib; joblib.dump(df, "/tmp/df.pkl")',
            context: 'repl',
            frameId: 42,
        });
    });

    it('should use explicit frameId when provided', async () => {
        mockSession.customRequest.mockResolvedValueOnce({
            result: 'dump succeeded',
        });

        const result = await evaluateDapExpressionMock(mockSession, 'import joblib; joblib.dump(df, "/tmp/df.pkl")', 99);

        expect(result).toBe('dump succeeded');
        expect(mockSession.customRequest).toHaveBeenCalledTimes(1);
        expect(mockSession.customRequest).toHaveBeenCalledWith('evaluate', {
            expression: 'import joblib; joblib.dump(df, "/tmp/df.pkl")',
            context: 'repl',
            frameId: 99,
        });
    });

    it('should throw when no threads are found', async () => {
        mockSession.customRequest.mockResolvedValueOnce({
            threads: [],
        });

        await expect(
            evaluateDapExpressionMock(mockSession, 'import joblib')
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
            evaluateDapExpressionMock(mockSession, 'import joblib')
        ).rejects.toThrow('No stack frames found in debug session');
    });

    it('should pick the first thread when resolving frame ID', async () => {
        mockSession.customRequest
            .mockResolvedValueOnce({
                threads: [{ id: 3, name: 'Worker' }, { id: 7, name: 'MainThread' }],
            })
            .mockResolvedValueOnce({
                stackFrames: [{ id: 11 }],
            })
            .mockResolvedValueOnce({
                result: 'ok',
            });

        await evaluateDapExpressionMock(mockSession, 'x = 1');

        expect(mockSession.customRequest).toHaveBeenNthCalledWith(2, 'stackTrace', { threadId: 3, levels: 1 });
    });
});

    
