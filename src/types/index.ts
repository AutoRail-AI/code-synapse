/**
 * Shared types for Code-Synapse
 */

export interface ProjectConfig {
  root: string;
  languages: string[];
  exclude: string[];
}

export interface ParsedFile {
  path: string;
  language: string;
  ast: unknown;
  symbols: Symbol[];
}

export interface Symbol {
  name: string;
  kind: SymbolKind;
  location: Location;
  references: Location[];
}

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "import"
  | "export"
  | "type"
  | "interface";

export interface Location {
  file: string;
  line: number;
  column: number;
}

export interface GraphNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface EmbeddingResult {
  text: string;
  vector: number[];
}

export interface SearchResult {
  id: string;
  score: number;
  content: string;
  metadata: Record<string, unknown>;
}
