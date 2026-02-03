import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Code,
  FileCode,
  Box,
  Layers,
  Hash
} from 'lucide-react';
import { useExplorerStore, useUIStore } from '../../store';
import { EntityInsightsPanel } from '../common/EntityInsightsPanel';
import {
  getFileTree,
  getFileContent,
  getFileEntities,
  type FileTree,
  type EntitySummary,
} from '../../api/client';

export function ExplorerView() {
  const { selectedFile, setSelectedFile, selectedEntity, setSelectedEntity } =
    useUIStore();
  const {
    fileTree,
    setFileTree,
    expandedPaths,
    toggleExpanded,
    fileContent,
    setFileContent,
    fileEntities,
    setFileEntities,
  } = useExplorerStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load file tree on mount
  useEffect(() => {
    getFileTree()
      .then((tree) => {
        setFileTree(tree);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [setFileTree]);

  // Load file content and entities when a file is selected
  useEffect(() => {
    if (!selectedFile) {
      setFileContent(null);
      setFileEntities([]);
      return;
    }

    Promise.all([
      getFileContent(selectedFile),
      getFileEntities(selectedFile),
    ])
      .then(([content, entities]) => {
        setFileContent(content);
        setFileEntities(entities);
      })
      .catch((err) => {
        console.error('Failed to load file:', err);
      });
  }, [selectedFile, setFileContent, setFileEntities]);

  const handleFileSelect = useCallback(
    (path: string) => {
      setSelectedFile(path);
      setSelectedEntity(null);
    },
    [setSelectedFile, setSelectedEntity]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        Loading file tree...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* File Tree Panel */}
      <div className="w-72 border-r border-slate-700 flex flex-col">
        <div className="panel-header flex items-center gap-2">
          <FolderOpen className="w-4 h-4" />
          File Explorer
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar p-2">
          {fileTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedFile}
              expandedPaths={expandedPaths}
              onToggle={toggleExpanded}
              onSelect={handleFileSelect}
            />
          ))}
        </div>
      </div>

      {/* Code Viewer Panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="panel-header flex items-center gap-2">
          <FileCode className="w-4 h-4" />
          {selectedFile ? selectedFile.split('/').pop() : 'Select a file'}
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar bg-slate-900">
          {selectedFile && fileContent ? (
            <CodeViewer
              content={fileContent}
              entities={fileEntities}
              selectedEntity={selectedEntity}
              onEntityClick={setSelectedEntity}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500">
              Select a file from the tree to view its contents
            </div>
          )}
        </div>
      </div>

      {/* Entity Insights Panel */}
      <div className="w-96 border-l border-slate-700 flex flex-col bg-slate-900">
        {selectedEntity ? (
          <EntityInsightsPanel entity={selectedEntity} onClose={() => setSelectedEntity(null)} />
        ) : fileEntities.length > 0 ? (
          <div className="flex flex-col h-full">
            <div className="panel-header flex items-center gap-2 p-2 border-b border-slate-700 bg-slate-800">
              <Code className="w-4 h-4" />
              File Entities
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
              <EntityList
                entities={fileEntities}
                onSelect={setSelectedEntity}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 p-4 text-center">
            Select a file to see its entities
          </div>
        )}
      </div>
    </div>
  );
}

// File tree node component
function FileTreeNode({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onToggle,
  onSelect,
}: {
  node: FileTree;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';

  const handleClick = () => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1 py-1 px-2 rounded text-sm hover:bg-slate-700/50 ${isSelected ? 'bg-slate-700 text-white' : 'text-slate-300'
          }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-yellow-500" />
            ) : (
              <Folder className="w-4 h-4 text-yellow-500" />
            )}
          </>
        ) : (
          <>
            <span className="w-4" />
            <File className="w-4 h-4 text-slate-400" />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {node.entityCount !== undefined && node.entityCount > 0 && (
          <span className="ml-auto text-xs text-slate-500">
            {node.entityCount}
          </span>
        )}
      </button>
      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Simple code viewer (will be replaced with Monaco later)
function CodeViewer({
  content,
  entities,
  selectedEntity,
  onEntityClick,
}: {
  content: string;
  entities: EntitySummary[];
  selectedEntity: EntitySummary | null;
  onEntityClick: (entity: EntitySummary | null) => void;
}) {
  const lines = content.split('\n');

  // Build a map of line -> entities
  const lineEntities = new Map<number, EntitySummary[]>();
  entities.forEach((entity) => {
    for (let line = entity.startLine; line <= entity.endLine; line++) {
      const existing = lineEntities.get(line) || [];
      existing.push(entity);
      lineEntities.set(line, existing);
    }
  });

  return (
    <div className="font-mono text-sm">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const entityList = lineEntities.get(lineNum);
            const isHighlighted =
              selectedEntity &&
              lineNum >= selectedEntity.startLine &&
              lineNum <= selectedEntity.endLine;

            return (
              <tr
                key={idx}
                className={`${isHighlighted ? 'bg-blue-900/30' : 'hover:bg-slate-800/50'
                  }`}
                onClick={() => {
                  if (entityList && entityList.length > 0) {
                    onEntityClick(entityList[0]);
                  }
                }}
              >
                <td className="text-right pr-4 pl-2 text-slate-600 select-none border-r border-slate-700 w-12">
                  {lineNum}
                </td>
                <td className="pl-4 whitespace-pre text-slate-300">
                  {line || ' '}
                  {entityList && entityList.length > 0 && (
                    <span className="ml-2">
                      {entityList.map((e) => (
                        <span
                          key={e.id}
                          className={`inline-block w-2 h-2 rounded-full ml-1 ${e.kind === 'function'
                              ? 'bg-blue-500'
                              : e.kind === 'class'
                                ? 'bg-purple-500'
                                : e.kind === 'interface'
                                  ? 'bg-cyan-500'
                                  : 'bg-gray-500'
                            }`}
                          title={`${e.kind}: ${e.name}`}
                        />
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Entity list for sidebar
function EntityList({
  entities,
  onSelect,
}: {
  entities: EntitySummary[];
  onSelect: (entity: EntitySummary) => void;
}) {
  const groupedByKind = entities.reduce(
    (acc, entity) => {
      const kind = entity.kind;
      if (!acc[kind]) acc[kind] = [];
      acc[kind].push(entity);
      return acc;
    },
    {} as Record<string, EntitySummary[]>
  );

  const kindOrder = ['class', 'interface', 'function', 'variable'];
  const sortedKinds = Object.keys(groupedByKind).sort(
    (a, b) => kindOrder.indexOf(a) - kindOrder.indexOf(b)
  );

  return (
    <div className="p-2">
      {sortedKinds.map((kind) => (
        <div key={kind} className="mb-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase mb-2 px-2">
            <EntityIcon kind={kind} />
            {kind}s ({groupedByKind[kind].length})
          </div>
          {groupedByKind[kind].map((entity) => (
            <button
              key={entity.id}
              onClick={() => onSelect(entity)}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-700/50 text-sm text-slate-300"
            >
              <div className="flex items-center gap-2">
                <EntityIcon kind={entity.kind} />
                <span className="truncate">{entity.name}</span>
              </div>
              <div className="text-xs text-slate-500 ml-6">
                Line {entity.startLine}
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function EntityIcon({
  kind,
}: {
  kind: string;
}) {
  const sizeClass = 'w-4 h-4';
  const colorClass =
    kind === 'function'
      ? 'text-blue-400'
      : kind === 'class'
        ? 'text-purple-400'
        : kind === 'interface'
          ? 'text-cyan-400'
          : 'text-gray-400';

  switch (kind) {
    case 'function':
      return <Box className={`${sizeClass} ${colorClass}`} />;
    case 'class':
      return <Layers className={`${sizeClass} ${colorClass}`} />;
    case 'interface':
      return <Hash className={`${sizeClass} ${colorClass}`} />;
    default:
      return <Code className={`${sizeClass} ${colorClass}`} />;
  }
}

export default ExplorerView;
