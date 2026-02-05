
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallGraphLinker } from '../call-graph-linker.js';
import { createEmptyBatch } from '../types.js';
import type { ExtractionResult, UnresolvedCall } from '../types.js';
import type { IGraphStore } from '../../interfaces/IGraphStore.js';

describe('CallGraphLinker', () => {
    let mockStore: IGraphStore;
    let linker: CallGraphLinker;

    beforeEach(() => {
        mockStore = {
            query: vi.fn(),
            execute: vi.fn(),
            writeBatch: vi.fn(),
            close: vi.fn(),
            initialize: vi.fn(),
            deleteFileEntities: vi.fn(),
        } as unknown as IGraphStore;

        linker = new CallGraphLinker(mockStore);
    });

    const createMockResult = (
        fileId: string,
        filePath: string,
        functions: Array<{ id: string, name: string, isExported: boolean }> = [],
        unresolvedCalls: UnresolvedCall[] = [],
        imports: Array<{ from: string, to: string, symbols: string[] }> = []
    ): ExtractionResult => {
        const batch = createEmptyBatch();

        // Add functions
        functions.forEach(f => {
            batch.function.push([
                f.id, f.name, fileId, 1, 10, 1, 1, 'sig', 'void', f.isExported, false, false, 1, 0, null, null, null
            ]);
        });

        return {
            fileId,
            filePath,
            batch,
            unresolvedCalls,
            unresolvedTypes: [],
            embeddingChunks: [],
            errors: [],
            stats: {
                functions: functions.length,
                classes: 0,
                interfaces: 0,
                typeAliases: 0,
                variables: 0,
                imports: 0,
                exports: 0,
                ghostNodes: 0
            }
        };
    };

    it('should resolve local calls within the same file', async () => {
        const result = createMockResult(
            'file1',
            '/src/file1.ts',
            [{ id: 'fn1', name: 'myFunc', isExported: false }],
            [{
                callerId: 'caller1',
                calleeName: 'myFunc',
                modulePath: null,
                lineNumber: 5,
                isDirectCall: true,
                isAsync: false
            }]
        );

        // Mock empty imports
        vi.mocked(mockStore.query).mockResolvedValue({
            rows: [],
            stats: { rowsAffected: 0, executionTimeMs: 0 }
        });

        const linkResult = await linker.linkCalls([result]);

        expect(linkResult.resolvedCalls).toHaveLength(1);
        expect(linkResult.resolvedCalls[0]).toEqual(['caller1', 'fn1', 5, true, false]);
    });

    it('should resolve cross-file calls via imports', async () => {
        const file1 = createMockResult(
            'file1',
            '/src/file1.ts',
            [],
            [{
                callerId: 'caller1',
                calleeName: 'utilFunc', // Imported name
                modulePath: './utils.ts',
                lineNumber: 10,
                isDirectCall: true,
                isAsync: false
            }]
        );

        const utils = createMockResult(
            'utils',
            '/src/utils.ts',
            [{ id: 'utilFn1', name: 'utilFunc', isExported: true }]
        );

        // Mock imports query
        vi.mocked(mockStore.query).mockResolvedValue({
            rows: [
                { from_id: 'file1', to_id: 'utils', imported_symbols: ['utilFunc'] }
            ],
            stats: { rowsAffected: 1, executionTimeMs: 0 }
        });

        const linkResult = await linker.linkCalls([file1, utils]);

        expect(linkResult.resolvedCalls).toHaveLength(1);
        // Should resolve to 'utilFn1' from utils.ts
        expect(linkResult.resolvedCalls[0]).toEqual(['caller1', 'utilFn1', 10, true, false]);
    });
});
