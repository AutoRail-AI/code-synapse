import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { useExplorerStore, useUIStore } from '../../store';
import {
  getFileTree,
  getFileContent,
  getFileEntities,
  type FileTree,
} from '../../api/client';
import { MonacoViewer } from './MonacoViewer';
import { ContextPanel } from './ContextPanel';

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
              onSelect={handleFileSelect}
            />
          ))}
        </div>
      </div>

      {/* Code Viewer Panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
        {selectedFile && fileContent ? (
          <MonacoViewer
            content={fileContent}
            entities={fileEntities}
            selectedEntity={selectedEntity}
            onEntitySelect={setSelectedEntity}
            language={getLanguageFromPath(selectedFile)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
            <FolderOpen className="w-16 h-16 text-slate-700" />
            <div className="text-lg">Select a file to view code</div>
          </div>
        )}
      </div>

      {/* Context / Insights Panel (Right Sidebar) */}
      <div className="w-80 flex flex-col bg-slate-900 border-l border-slate-700">
        <ContextPanel
          filePath={selectedFile}
          entities={fileEntities}
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
        className={`w-full flex items-center gap-1 py-1 px-2 rounded text-sm transition-colors ${isSelected ? 'bg-blue-600/20 text-blue-200' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
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
            <FolderOpen className="w-4 h-4 text-yellow-500/80" />
          ) : (
            <Folder className="w-4 h-4 text-yellow-500/80" />
          )
        ) : (
          <File className="w-4 h-4 text-blue-400/80" />
        )}

        <span className="truncate flex-1 text-left ml-1">{node.name}</span>

        {node.entityCount !== undefined && node.entityCount > 0 && (
          <span className={`text-[10px] px-1.5 rounded-full ${isSelected ? 'bg-blue-500/30 text-blue-100' : 'bg-slate-800 text-slate-500'}`}>
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
