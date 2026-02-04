import { useRef, useEffect, useMemo, useState } from 'react';
import Editor, { Monaco, OnMount } from '@monaco-editor/react';
import { EntitySummary } from '../../api/client';
import { useUIStore } from '../../store';

interface MonacoViewerProps {
    content: string;
    language?: string;
    entities: EntitySummary[];
    selectedEntity: EntitySummary | null;
    onEntitySelect: (entity: EntitySummary | null) => void;
    className?: string;
}

export function MonacoViewer({
    content,
    language = 'typescript',
    entities,
    selectedEntity,
    onEntitySelect,
    className,
}: MonacoViewerProps) {
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<Monaco | null>(null);
    const decorationsRef = useRef<string[]>([]);
    // const { theme } = useUIStore(); // Theme not in store yet

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
