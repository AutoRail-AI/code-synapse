import { useRef, useEffect, useMemo, useCallback } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { EntitySummary, getEntityRelationships, getFileEntities } from '@/api/client.ts';

interface MonacoViewerProps {
    content: string;
    language?: string;
    entities: EntitySummary[];
    selectedEntity: EntitySummary | null;
    onEntitySelect: (entity: EntitySummary | null) => void;
    onNavigateToEntity?: (entity: EntitySummary) => void;
    className?: string;
}

export function MonacoViewer({
    content,
    language = 'typescript',
    entities,
    selectedEntity,
    onEntitySelect,
    onNavigateToEntity,
    className,
}: MonacoViewerProps) {
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<Monaco | null>(null);
    const decorationsRef = useRef<string[]>([]);
    const entitiesRef = useRef<EntitySummary[]>(entities);

    // Keep entities ref updated for use in async callbacks
    useEffect(() => {
        entitiesRef.current = entities;
    }, [entities]);

    // Find entity at a given position
    const findEntityAtPosition = useCallback((lineNumber: number) => {
        return entitiesRef.current
            .filter(e => e.startLine <= lineNumber && e.endLine >= lineNumber)
            .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null;
    }, []);

    // Handle editor mount
    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        // Define our custom theme to match the app
        monaco.editor.defineTheme('synapse-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '64748b' }, // slate-500
                { token: 'keyword', foreground: 'c084fc' }, // purple-400
                { token: 'string', foreground: '86efac' }, // green-300
                { token: 'function', foreground: '60a5fa' }, // blue-400
                { token: 'class', foreground: 'f472b6' }, // pink-400
                { token: 'interface', foreground: '22d3ee' }, // cyan-400
            ],
            colors: {
                'editor.background': '#0f172a', // slate-900
                'editor.foreground': '#f1f5f9', // slate-100
                'editor.lineHighlightBackground': '#1e293b', // slate-800
                'editorLineNumber.foreground': '#475569', // slate-600
                'editor.selectionBackground': '#334155', // slate-700
            },
        });

        monaco.editor.setTheme('synapse-dark');

        // Add click listener for entity selection
        editor.onMouseDown((e) => {
            if (e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT) {
                const position = e.target.position;
                if (position) {
                    // Find entity at this position
                    // We prefer the smallest entity that contains the position (most specific)
                    const clickedEntity = entities
                        .filter(
                            (ent) =>
                                ent.startLine <= position.lineNumber &&
                                ent.endLine >= position.lineNumber
                        )
                        .sort((a, b) => {
                            const sizeA = a.endLine - a.startLine;
                            const sizeB = b.endLine - b.startLine;
                            return sizeA - sizeB;
                        })[0];

                    if (clickedEntity) {
                        onEntitySelect(clickedEntity);
                    } else {
                        // Only clear if clicking explicitly on code that isn't an entity? 
                        // Or maybe keep selection? Let's clear for now to "deselect".
                        onEntitySelect(null);
                    }
                }
            }
        });

        // Register CodeLens provider for inline entity metrics
        const codeLensProvider = monaco.languages.registerCodeLensProvider(language, {
            provideCodeLenses: () => {
                const lenses = entities.map((entity) => {
                    const confidence = entity.confidence
                        ? `${Math.round(entity.confidence * 100)}% confidence`
                        : 'Not analyzed';
                    const classification = entity.classification
                        ? `${entity.classification}`
                        : '';
                    const label = [confidence, classification].filter(Boolean).join(' • ');

                    return {
                        range: new monaco.Range(entity.startLine, 1, entity.startLine, 1),
                        command: {
                            id: 'synapse.selectEntity',
                            title: `📊 ${label}`,
                            arguments: [entity],
                        },
                    };
                });
                return { lenses, dispose: () => { } };
            },
            resolveCodeLens: (_model: unknown, lens: { range: unknown; command: unknown }) => lens,
        });

        // Register Definition Provider (F12 / Ctrl+Click -> Go to Definition)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const definitionProvider = monaco.languages.registerDefinitionProvider(language, {
            provideDefinition: async (model: any, position: any) => {
                const entity = findEntityAtPosition(position.lineNumber);
                if (!entity) return null;

                try {
                    // Get relationships for this entity
                    const relationships = await getEntityRelationships(entity.id);

                    // Find "calls" relationships - the definitions we can navigate to
                    const callsRelationships = relationships.filter(r => r.type === 'calls' || r.type === 'imports');

                    if (callsRelationships.length === 0) {
                        // If no outgoing calls, the entity itself is probably the definition
                        // Return its own location
                        return {
                            uri: model.uri,
                            range: new monaco.Range(entity.startLine, 1, entity.startLine, 1),
                        };
                    }

                    // Return all callable definitions
                    const definitions = await Promise.all(
                        callsRelationships.map(async (rel) => {
                            const target = rel.target;
                            // If target is in a different file, we need to fetch that file's entities
                            if (target.filePath && target.filePath !== entity.filePath) {
                                // For cross-file navigation, trigger the callback
                                if (onNavigateToEntity) {
                                    const targetEntities = await getFileEntities(target.filePath);
                                    const targetEntity = targetEntities.find(e => e.id === target.id);
                                    if (targetEntity) {
                                        // Use setTimeout to avoid blocking the provider
                                        setTimeout(() => onNavigateToEntity(targetEntity), 0);
                                    }
                                }
                                return null;
                            }
                            // Same file navigation
                            const targetEntity = entitiesRef.current.find(e => e.id === target.id);
                            if (targetEntity) {
                                return {
                                    uri: model.uri,
                                    range: new monaco.Range(targetEntity.startLine, 1, targetEntity.startLine, 1),
                                };
                            }
                            return null;
                        })
                    );

                    const validDefinitions = definitions.filter(Boolean);
                    return validDefinitions.length > 0 ? validDefinitions : null;
                } catch (error) {
                    console.error('Error fetching definition:', error);
                    return null;
                }
            },
        });

        // Register Reference Provider (Shift+F12 -> Find All References)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const referenceProvider = monaco.languages.registerReferenceProvider(language, {
            provideReferences: async (model: any, position: any) => {
                const entity = findEntityAtPosition(position.lineNumber);
                if (!entity) return null;

                try {
                    // Get relationships for this entity
                    const relationships = await getEntityRelationships(entity.id);

                    // Find "called_by" and "imported_by" relationships - these are references
                    const references = relationships.filter(r => r.type === 'called_by' || r.type === 'imported_by');

                    // Include the definition itself as a reference
                    const allReferences: Array<{ uri: typeof model.uri; range: InstanceType<typeof monaco.Range> }> = [
                        {
                            uri: model.uri,
                            range: new monaco.Range(entity.startLine, 1, entity.startLine, 1),
                        },
                    ];

                    // Add all callers/importers as references
                    for (const rel of references) {
                        const target = rel.target;
                        // Same file reference
                        const targetEntity = entitiesRef.current.find(e => e.id === target.id);
                        if (targetEntity) {
                            allReferences.push({
                                uri: model.uri,
                                range: new monaco.Range(targetEntity.startLine, 1, targetEntity.startLine, 1),
                            });
                        }
                    }

                    return allReferences;
                } catch (error) {
                    console.error('Error fetching references:', error);
                    return null;
                }
            },
        });

        // Register Hover Provider for richer entity tooltips
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hoverProvider = monaco.languages.registerHoverProvider(language, {
            provideHover: async (_model: any, position: any) => {
                const entity = findEntityAtPosition(position.lineNumber);
                if (!entity) return null;

                try {
                    const relationships = await getEntityRelationships(entity.id);
                    const callers = relationships.filter(r => r.type === 'called_by').length;
                    const callees = relationships.filter(r => r.type === 'calls').length;

                    const contents = [
                        { value: `**${entity.name}** \`${entity.kind}\`` },
                    ];

                    if (entity.justification) {
                        contents.push({ value: `> ${entity.justification}` });
                    }

                    if (entity.classification) {
                        contents.push({ value: `Classification: **${entity.classification}**` });
                    }

                    if (callers > 0 || callees > 0) {
                        contents.push({ value: `📊 ${callers} callers • ${callees} callees` });
                    }

                    contents.push({ value: `_Press F12 to go to definition, Shift+F12 for references_` });

                    return {
                        range: new monaco.Range(
                            entity.startLine, 1,
                            entity.endLine, 1
                        ),
                        contents,
                    };
                } catch {
                    return null;
                }
            },
        });

        // Register command for CodeLens click
        editor.addCommand(0, () => { }); // Placeholder; actual handling via onMouseDown

        // Cleanup on unmount
        return () => {
            codeLensProvider.dispose();
            definitionProvider.dispose();
            referenceProvider.dispose();
            hoverProvider.dispose();
        };
    };

    // Update decorations when entities change
    useEffect(() => {
        if (!editorRef.current || !monacoRef.current) return;

        const editor = editorRef.current;
        const monaco = monacoRef.current;

        const newDecorations: any[] = [];

        // 1. Entity Highlights (Gutters & Content)
        entities.forEach((entity) => {
            const isSelected = selectedEntity?.id === entity.id;

            let className = '';
            let glyphClass = '';
            let hoverMessage = `**${entity.name}** (${entity.kind})\n\n`;

            if (entity.justification) {
                hoverMessage += `> ${entity.justification}\n\n`;
            }

            switch (entity.kind) {
                case 'function':
                    className = 'entity-function';
                    glyphClass = 'glyph-function';
                    break;
                case 'class':
                    className = 'entity-class';
                    glyphClass = 'glyph-class';
                    break;
                case 'interface':
                    className = 'entity-interface';
                    glyphClass = 'glyph-interface';
                    break;
                default:
                    className = 'entity-variable';
                    glyphClass = 'glyph-variable';
            }

            if (isSelected) {
                className += ' entity-selected';
            }

            newDecorations.push({
                range: new monaco.Range(entity.startLine, 1, entity.endLine, 1),
                options: {
                    isWholeLine: true,
                    className: className, // Background color
                    glyphMarginClassName: glyphClass, // Gutter icon
                    hoverMessage: { value: hoverMessage },
                    minimap: {
                        color: isSelected ? '#ffffff' : undefined,
                        position: 1, // Inline
                    }
                },
            });
        });

        // Apply decorations
        decorationsRef.current = editor.deltaDecorations(
            decorationsRef.current,
            newDecorations
        );

    }, [entities, selectedEntity]);

    // Handle selection change from outside (scroll to entity)
    useEffect(() => {
        if (selectedEntity && editorRef.current) {
            editorRef.current.revealLineInCenter(selectedEntity.startLine);
        }
    }, [selectedEntity]);

    // Adjust options
    const options: any = useMemo(
        () => ({
            readOnly: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            glyphMargin: true, // Enable for entity icons
            lineNumbers: 'on',
            renderLineHighlight: 'all',
            automaticLayout: true,
            padding: { top: 16, bottom: 16 },
            domReadOnly: true, // Prevent keyboard popping up
        }),
        []
    );

    return (
        <div className={`h-full w-full overflow-hidden ${className}`}>
            <style>{`
        .entity-function { background: rgba(59, 130, 246, 0.05); }
        .entity-class { background: rgba(168, 85, 247, 0.05); }
        .entity-interface { background: rgba(6, 182, 212, 0.05); }
        .entity-selected { background: rgba(255, 255, 255, 0.1) !important; border-left: 2px solid white; }
        
        .glyph-function { background: #3b82f6; width: 4px !important; margin-left: 5px; }
        .glyph-class { background: #a855f7; width: 4px !important; margin-left: 5px; }
        .glyph-interface { background: #06b6d4; width: 4px !important; margin-left: 5px; }
        
        /* Custom scrollbar override within monaco if needed */
      `}</style>
            <Editor
                height="100%"
                defaultLanguage={language}
                value={content}
                onMount={handleEditorDidMount}
                options={options}
                theme="synapse-dark"
            />
        </div>
    );
}
