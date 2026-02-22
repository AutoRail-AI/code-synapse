import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Home,
} from 'lucide-react';
import { useExplorerStore, useUIStore } from '../../store';
import {
  getFileTree,
  getFileContent,
  getFileEntities,
  type FileTree,
} from '../../api/client';
import { MonacoViewer } from './MonacoViewer';
import { EntityGrid } from './EntityGrid';
import { ContextPanel } from './ContextPanel';
import { useKnowledgeStore } from '../../store';
import { getFunctions, getClasses, getInterfaces } from '../../api/client';

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

  const { entities, setEntities } = useKnowledgeStore();
  const [selectedType, setSelectedType] = useState<'file' | 'directory'>('file');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Navigate to an entity (potentially in a different file)
  const handleNavigateToEntity = useCallback((entity: { filePath: string; id: string; name: string; kind: string; startLine: number; endLine: number }) => {
    // If the entity is in a different file, switch to that file
    if (entity.filePath !== selectedFile) {
      setSelectedFile(entity.filePath);
      setSelectedType('file');
    }
    // Select the entity (with a small delay to ensure file content loads)
    setTimeout(() => {
      setSelectedEntity(entity as typeof selectedEntity);
    }, 100);
  }, [selectedFile, setSelectedFile, setSelectedEntity]);

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
    if (!selectedFile || selectedType === 'directory') {
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
  }, [selectedFile, selectedType, setFileContent, setFileEntities]);



  // Load all knowledge entities on mount (for the Unified View)
  useEffect(() => {
    Promise.all([
      getFunctions({ limit: 1000 }),
      getClasses({ limit: 1000 }),
      getInterfaces({ limit: 1000 }),
    ]).then(([fns, classes, ifaces]) => {
      setEntities([...fns, ...classes, ...ifaces]);
    }).catch(console.error);
  }, [setEntities]);

  const handleSelect = useCallback(
    (path: string, type: 'file' | 'directory') => {
      setSelectedFile(path);
      setSelectedType(type);
      setSelectedEntity(null);

      // If directory, toggle expansion as well
      if (type === 'directory') {
        toggleExpanded(path);
      }
    },
    [setSelectedFile, setSelectedEntity, toggleExpanded]
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
      <div className="w-72 border-r border-slate-700 flex flex-col bg-slate-900/50">
        <div className="panel-header flex items-center gap-2 p-2 border-b border-slate-700">
          <FolderOpen className="w-4 h-4 text-slate-400" />
          <span className="font-medium text-sm text-slate-200">Explorer</span>
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
              onSelect={handleSelect}
              allEntities={entities}
            />
          ))}
        </div>
      </div>

      {/* Code Viewer Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
        {/* Breadcrumb Navigation */}
        {selectedFile && (
          <Breadcrumb
            path={selectedFile}
            onNavigate={(path) => handleSelect(path, 'directory')}
          />
        )}

        {selectedFile && selectedType === 'directory' ? (
          <div className="h-full flex flex-col bg-slate-900">
            <div className="p-4 border-b border-slate-700 bg-slate-800/30">
              <h2 className="text-lg font-medium text-slate-200 flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-rail-purple" />
                {selectedFile.split('/').pop()}
                <span className="text-sm text-slate-500 font-normal ml-2">Folder Overview</span>
              </h2>
            </div>
            <div className="flex-1 overflow-hidden">
              <EntityGrid
                entities={entities.filter(e => e.filePath.includes(selectedFile))}
                onSelect={setSelectedEntity}
                selectedId={selectedEntity?.id}
              />
            </div>
          </div>
        ) : selectedFile && fileContent ? (
          <MonacoViewer
            content={fileContent}
            entities={fileEntities}
            selectedEntity={selectedEntity}
            onEntitySelect={setSelectedEntity}
            onNavigateToEntity={handleNavigateToEntity}
            language={getLanguageFromPath(selectedFile)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
            <FolderOpen className="w-16 h-16 text-slate-700" />
            <div className="text-lg">Select a file or folder</div>
          </div>
        )}
      </div>

      {/* Context / Insights Panel (Right Sidebar) */}
      <div className="w-80 flex flex-col bg-slate-900 border-l border-slate-700">
        <ContextPanel
          path={selectedFile}
          entities={selectedType === 'directory' ? entities.filter(e => e.filePath.includes(selectedFile || '')) : fileEntities}
        />
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
  allEntities,
}: {
  node: FileTree;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string, type: 'file' | 'directory') => void;
  allEntities: { filePath: string; justification?: string; classification?: string }[];
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';

  // Calculate justification status for this file/folder
  const fileEntities = allEntities.filter(e =>
    isDirectory ? e.filePath.startsWith(node.path) : e.filePath === node.path
  );
  const hasEntities = fileEntities.length > 0;
  const allJustified = hasEntities && fileEntities.every(e => e.justification);
  const someJustified = hasEntities && fileEntities.some(e => e.justification);

  const statusColor = allJustified
    ? 'bg-green-500'
    : someJustified
      ? 'bg-yellow-500'
      : hasEntities
        ? 'bg-red-500'
        : '';

  const handleClick = () => {
    onSelect(node.path, node.type); // Select both files and folders
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1 py-1 px-2 rounded text-sm transition-colors ${isSelected ? 'bg-electric-cyan/15 text-electric-cyan' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="opacity-70">
          {isDirectory ? (
            isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <span className="w-3.5" />
          )}
        </span>

        {isDirectory ? (
          isExpanded ? (
            <FolderOpen className="w-4 h-4 text-rail-purple" />
          ) : (
            <Folder className="w-4 h-4 text-rail-purple" />
          )
        ) : (
          <File className="w-4 h-4 text-electric-cyan" />
        )}

        <span className="truncate flex-1 text-left ml-1">{node.name}</span>

        {/* Status indicator */}
        {statusColor && (
          <span className={`w-2 h-2 rounded-full ${statusColor}`} title={
            allJustified ? 'Fully justified' : someJustified ? 'Partially justified' : 'Not justified'
          } />
        )}

        {node.entityCount !== undefined && node.entityCount > 0 && (
          <span className={`text-[10px] px-1.5 rounded-full ${isSelected ? 'bg-electric-cyan/20 text-electric-cyan' : 'bg-slate-800 text-slate-500'}`}>
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
              allEntities={allEntities}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Breadcrumb navigation component
function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const segments = path.split('/').filter(Boolean);

  return (
    <div className="flex items-center gap-1 px-4 py-2 bg-slate-800/50 border-b border-slate-700 text-sm overflow-x-auto">
      <button
        onClick={() => onNavigate('/')}
        className="text-slate-400 hover:text-electric-cyan transition-colors flex items-center gap-1"
      >
        <Home className="w-3.5 h-3.5" />
      </button>
      {segments.map((segment, index) => {
        const segmentPath = '/' + segments.slice(0, index + 1).join('/');
        const isLast = index === segments.length - 1;

        return (
          <div key={segmentPath} className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3 text-slate-600" />
            <button
              onClick={() => !isLast && onNavigate(segmentPath)}
              className={`truncate max-w-32 ${isLast
                ? 'text-slate-200 font-medium cursor-default'
                : 'text-slate-400 hover:text-electric-cyan transition-colors'
                }`}
            >
              {segment}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function getLanguageFromPath(path: string): string {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

export default ExplorerView;
