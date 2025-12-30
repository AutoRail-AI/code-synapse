/**
 * Graph Operations
 *
 * High-level CRUD operations for the code knowledge graph.
 * Provides type-safe methods for working with nodes and relationships.
 * Uses CozoScript (Datalog) queries for CozoDB.
 *
 * @module
 */

import type { GraphDatabase, Transaction } from "./database.js";
import type { NodeName } from "./schema-definitions.js";

// =============================================================================
// Node Types (Generated from Schema)
// =============================================================================

/**
 * File node in the graph
 */
export interface FileNode {
  id: string;
  path: string;
  relativePath: string;
  extension: string;
  hash: string;
  size: number;
  lastModified: number;
  language: string;
  framework?: string;
}

/**
 * Function node in the graph
 */
export interface FunctionNode {
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  signature: string;
  returnType?: string;
  isExported: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  complexity: number;
  docComment?: string;
  businessLogic?: string;
  inferenceConfidence?: number;
}

/**
 * Class node in the graph
 */
export interface ClassNode {
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extends?: string;
  implements: string[];
  docComment?: string;
}

/**
 * Interface node in the graph
 */
export interface InterfaceNode {
  id: string;
  name: string;
  fileId: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  extends: string[];
  docComment?: string;
}

/**
 * Variable node in the graph
 */
export interface VariableNode {
  id: string;
  name: string;
  fileId: string;
  line: number;
  column: number;
  type?: string;
  isConst: boolean;
  isExported: boolean;
  scope: "global" | "function" | "block";
  initialValue?: string;
}

/**
 * Union type of all node types
 */
export type AnyNode = FileNode | FunctionNode | ClassNode | InterfaceNode | VariableNode;

// =============================================================================
// Relationship Types
// =============================================================================

/**
 * CONTAINS relationship (File -> Function/Class/etc.)
 */
export interface ContainsRelationship {
  fromId: string;
  toId: string;
  lineNumber: number;
}

/**
 * CALLS relationship (Function -> Function)
 */
export interface CallsRelationship {
  fromId: string;
  toId: string;
  lineNumber: number;
  isDirectCall: boolean;
  isAwait: boolean;
}

/**
 * IMPORTS relationship (File -> File)
 */
export interface ImportsRelationship {
  fromId: string;
  toId: string;
  importedSymbols: string[];
  importType: "named" | "default" | "namespace" | "side-effect";
  isTypeOnly: boolean;
}

/**
 * EXTENDS relationship (Class/Interface -> Class/Interface)
 */
export interface ExtendsRel {
  fromId: string;
  toId: string;
}

/**
 * IMPLEMENTS relationship (Class -> Interface)
 */
export interface ImplementsRelationship {
  fromId: string;
  toId: string;
}

// =============================================================================
// Graph Operations Class
// =============================================================================

/**
 * High-level operations for the code knowledge graph.
 * Uses CozoScript (Datalog) queries.
 *
 * @example
 * ```typescript
 * const ops = new GraphOperations(db);
 *
 * // Create nodes
 * await ops.createFile({ id: 'file:1', path: '/src/index.ts', ... });
 * await ops.createFunction({ id: 'fn:1', name: 'main', fileId: 'file:1', ... });
 *
 * // Create relationships
 * await ops.createContains({ fromId: 'file:1', toId: 'fn:1', lineNumber: 10 });
 *
 * // Query
 * const functions = await ops.getFunctionsByFile('file:1');
 * const callers = await ops.getCallers('fn:1');
 * ```
 */
export class GraphOperations {
  constructor(private db: GraphDatabase) {}

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Creates a File node.
   */
  async createFile(file: FileNode, tx?: Transaction): Promise<void> {
    const script = `
      ?[id, path, relative_path, extension, hash, size, last_modified, language, framework] <- [[
        $id, $path, $relativePath, $extension, $hash, $size, $lastModified, $language, $framework
      ]]
      :put file {id => path, relative_path, extension, hash, size, last_modified, language, framework}
    `;
    await this.db.execute(
      script,
      {
        id: file.id,
        path: file.path,
        relativePath: file.relativePath,
        extension: file.extension,
        hash: file.hash,
        size: file.size,
        lastModified: file.lastModified,
        language: file.language,
        framework: file.framework ?? null,
      },
      tx
    );
  }

  /**
   * Gets a File by ID.
   */
  async getFile(id: string): Promise<FileNode | null> {
    const results = await this.db.query<{
      id: string;
      path: string;
      relative_path: string;
      extension: string;
      hash: string;
      size: number;
      last_modified: number;
      language: string;
      framework: string | null;
    }>(
      `?[id, path, relative_path, extension, hash, size, last_modified, language, framework] :=
        *file{id, path, relative_path, extension, hash, size, last_modified, language, framework},
        id = $id`,
      { id }
    );
    if (results.length === 0) return null;
    const r = results[0]!;
    return {
      id: r.id,
      path: r.path,
      relativePath: r.relative_path,
      extension: r.extension,
      hash: r.hash,
      size: r.size,
      lastModified: r.last_modified,
      language: r.language,
      framework: r.framework ?? undefined,
    };
  }

  /**
   * Gets a File by relative path.
   */
  async getFileByPath(relativePath: string): Promise<FileNode | null> {
    const results = await this.db.query<{
      id: string;
      path: string;
      relative_path: string;
      extension: string;
      hash: string;
      size: number;
      last_modified: number;
      language: string;
      framework: string | null;
    }>(
      `?[id, path, relative_path, extension, hash, size, last_modified, language, framework] :=
        *file{id, path, relative_path, extension, hash, size, last_modified, language, framework},
        relative_path = $relativePath`,
      { relativePath }
    );
    if (results.length === 0) return null;
    const r = results[0]!;
    return {
      id: r.id,
      path: r.path,
      relativePath: r.relative_path,
      extension: r.extension,
      hash: r.hash,
      size: r.size,
      lastModified: r.last_modified,
      language: r.language,
      framework: r.framework ?? undefined,
    };
  }

  /**
   * Updates a File node (upsert).
   */
  async updateFile(id: string, updates: Partial<FileNode>, tx?: Transaction): Promise<void> {
    // First get current file
    const current = await this.getFile(id);
    if (!current) return;

    // Merge updates
    const merged = { ...current, ...updates };

    // Upsert with merged data
    const script = `
      ?[id, path, relative_path, extension, hash, size, last_modified, language, framework] <- [[
        $id, $path, $relativePath, $extension, $hash, $size, $lastModified, $language, $framework
      ]]
      :put file {id => path, relative_path, extension, hash, size, last_modified, language, framework}
    `;
    await this.db.execute(
      script,
      {
        id: merged.id,
        path: merged.path,
        relativePath: merged.relativePath,
        extension: merged.extension,
        hash: merged.hash,
        size: merged.size,
        lastModified: merged.lastModified,
        language: merged.language,
        framework: merged.framework ?? null,
      },
      tx
    );
  }

  /**
   * Deletes a File and all contained entities.
   */
  async deleteFile(id: string, tx?: Transaction): Promise<void> {
    // Delete all contains relationships for this file
    await this.db.execute(
      `?[from_id, to_id] := *contains{from_id, to_id}, from_id = $id
       :rm contains {from_id, to_id}`,
      { id },
      tx
    );

    // Delete functions in this file
    await this.db.execute(
      `?[fn_id] := *function{id: fn_id, file_id}, file_id = $id
       :rm function {id: fn_id}`,
      { id },
      tx
    );

    // Delete classes in this file
    await this.db.execute(
      `?[cls_id] := *class{id: cls_id, file_id}, file_id = $id
       :rm class {id: cls_id}`,
      { id },
      tx
    );

    // Delete interfaces in this file
    await this.db.execute(
      `?[iface_id] := *interface{id: iface_id, file_id}, file_id = $id
       :rm interface {id: iface_id}`,
      { id },
      tx
    );

    // Delete variables in this file
    await this.db.execute(
      `?[var_id] := *variable{id: var_id, file_id}, file_id = $id
       :rm variable {id: var_id}`,
      { id },
      tx
    );

    // Delete imports relationships from this file
    await this.db.execute(
      `?[from_id, to_id] := *imports{from_id, to_id}, from_id = $id
       :rm imports {from_id, to_id}`,
      { id },
      tx
    );

    // Delete the file itself
    await this.db.execute(
      `?[id] <- [[$id]]
       :rm file {id}`,
      { id },
      tx
    );
  }

  /**
   * Gets all files.
   */
  async getAllFiles(): Promise<FileNode[]> {
    const results = await this.db.query<{
      id: string;
      path: string;
      relative_path: string;
      extension: string;
      hash: string;
      size: number;
      last_modified: number;
      language: string;
      framework: string | null;
    }>(
      `?[id, path, relative_path, extension, hash, size, last_modified, language, framework] :=
        *file{id, path, relative_path, extension, hash, size, last_modified, language, framework}`
    );
    return results.map((r) => ({
      id: r.id,
      path: r.path,
      relativePath: r.relative_path,
      extension: r.extension,
      hash: r.hash,
      size: r.size,
      lastModified: r.last_modified,
      language: r.language,
      framework: r.framework ?? undefined,
    }));
  }

  // ===========================================================================
  // Function Operations
  // ===========================================================================

  /**
   * Creates a Function node.
   */
  async createFunction(fn: FunctionNode, tx?: Transaction): Promise<void> {
    const script = `
      ?[id, name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
        is_exported, is_async, is_generator, complexity, doc_comment, business_logic, inference_confidence] <- [[
        $id, $name, $fileId, $startLine, $endLine, $startColumn, $endColumn, $signature, $returnType,
        $isExported, $isAsync, $isGenerator, $complexity, $docComment, $businessLogic, $inferenceConfidence
      ]]
      :put function {id => name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
        is_exported, is_async, is_generator, complexity, doc_comment, business_logic, inference_confidence}
    `;
    await this.db.execute(
      script,
      {
        id: fn.id,
        name: fn.name,
        fileId: fn.fileId,
        startLine: fn.startLine,
        endLine: fn.endLine,
        startColumn: fn.startColumn,
        endColumn: fn.endColumn,
        signature: fn.signature,
        returnType: fn.returnType ?? null,
        isExported: fn.isExported,
        isAsync: fn.isAsync,
        isGenerator: fn.isGenerator,
        complexity: fn.complexity,
        docComment: fn.docComment ?? null,
        businessLogic: fn.businessLogic ?? null,
        inferenceConfidence: fn.inferenceConfidence ?? null,
      },
      tx
    );
  }

  /**
   * Gets a Function by ID.
   */
  async getFunction(id: string): Promise<FunctionNode | null> {
    const results = await this.db.query<{
      id: string;
      name: string;
      file_id: string;
      start_line: number;
      end_line: number;
      start_column: number;
      end_column: number;
      signature: string;
      return_type: string | null;
      is_exported: boolean;
      is_async: boolean;
      is_generator: boolean;
      complexity: number;
      doc_comment: string | null;
      business_logic: string | null;
      inference_confidence: number | null;
    }>(
      `?[id, name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
         is_exported, is_async, is_generator, complexity, doc_comment, business_logic, inference_confidence] :=
        *function{id, name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
          is_exported, is_async, is_generator, complexity, doc_comment, business_logic, inference_confidence},
        id = $id`,
      { id }
    );
    if (results.length === 0) return null;
    const r = results[0]!;
    return {
      id: r.id,
      name: r.name,
      fileId: r.file_id,
      startLine: r.start_line,
      endLine: r.end_line,
      startColumn: r.start_column,
      endColumn: r.end_column,
      signature: r.signature,
      returnType: r.return_type ?? undefined,
      isExported: r.is_exported,
      isAsync: r.is_async,
      isGenerator: r.is_generator,
      complexity: r.complexity,
      docComment: r.doc_comment ?? undefined,
      businessLogic: r.business_logic ?? undefined,
      inferenceConfidence: r.inference_confidence ?? undefined,
    };
  }

  /**
   * Gets all functions in a file.
   */
  async getFunctionsByFile(fileId: string): Promise<FunctionNode[]> {
    const results = await this.db.query<{
      id: string;
      name: string;
      file_id: string;
      start_line: number;
      end_line: number;
      start_column: number;
      end_column: number;
      signature: string;
      return_type: string | null;
      is_exported: boolean;
      is_async: boolean;
      is_generator: boolean;
      complexity: number;
      doc_comment: string | null;
      business_logic: string | null;
      inference_confidence: number | null;
    }>(
      `?[id, name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
         is_exported, is_async, is_generator, complexity, doc_comment, business_logic, inference_confidence] :=
        *function{id, name, file_id, start_line, end_line, start_column, end_column, signature, return_type,
          is_exported, is_async, is_generator, complexity, doc_comment, business_logic, inference_confidence},
        file_id = $fileId
       :order start_line`,
      { fileId }
    );
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      fileId: r.file_id,
      startLine: r.start_line,
      endLine: r.end_line,
      startColumn: r.start_column,
      endColumn: r.end_column,
      signature: r.signature,
      returnType: r.return_type ?? undefined,
      isExported: r.is_exported,
      isAsync: r.is_async,
      isGenerator: r.is_generator,
      complexity: r.complexity,
      docComment: r.doc_comment ?? undefined,
      businessLogic: r.business_logic ?? undefined,
      inferenceConfidence: r.inference_confidence ?? undefined,
    }));
  }

  /**
   * Updates a Function node (upsert).
   */
  async updateFunction(
    id: string,
    updates: Partial<FunctionNode>,
    tx?: Transaction
  ): Promise<void> {
    // First get current function
    const current = await this.getFunction(id);
    if (!current) return;

    // Merge updates
    const merged = { ...current, ...updates };

    // Upsert with merged data
    await this.createFunction(merged, tx);
  }

  /**
   * Gets functions that call a given function.
   */
  async getCallers(functionId: string): Promise<FunctionNode[]> {
    const results = await this.db.query<{
      id: string;
      name: string;
      file_id: string;
      start_line: number;
      end_line: number;
      signature: string;
      is_exported: boolean;
    }>(
      `?[id, name, file_id, start_line, end_line, signature, is_exported] :=
        *calls{from_id: id, to_id},
        to_id = $functionId,
        *function{id, name, file_id, start_line, end_line, signature, is_exported}`,
      { functionId }
    );
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      fileId: r.file_id,
      startLine: r.start_line,
      endLine: r.end_line,
      startColumn: 0,
      endColumn: 0,
      signature: r.signature,
      isExported: r.is_exported,
      isAsync: false,
      isGenerator: false,
      complexity: 0,
    }));
  }

  /**
   * Gets functions called by a given function.
   */
  async getCallees(functionId: string): Promise<FunctionNode[]> {
    const results = await this.db.query<{
      id: string;
      name: string;
      file_id: string;
      start_line: number;
      end_line: number;
      signature: string;
      is_exported: boolean;
    }>(
      `?[id, name, file_id, start_line, end_line, signature, is_exported] :=
        *calls{from_id, to_id: id},
        from_id = $functionId,
        *function{id, name, file_id, start_line, end_line, signature, is_exported}`,
      { functionId }
    );
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      fileId: r.file_id,
      startLine: r.start_line,
      endLine: r.end_line,
      startColumn: 0,
      endColumn: 0,
      signature: r.signature,
      isExported: r.is_exported,
      isAsync: false,
      isGenerator: false,
      complexity: 0,
    }));
  }

  // ===========================================================================
  // Class Operations
  // ===========================================================================

  /**
   * Creates a Class node.
   */
  async createClass(cls: ClassNode, tx?: Transaction): Promise<void> {
    const script = `
      ?[id, name, file_id, start_line, end_line, is_exported, is_abstract, extends, implements, doc_comment] <- [[
        $id, $name, $fileId, $startLine, $endLine, $isExported, $isAbstract, $extends, $implements, $docComment
      ]]
      :put class {id => name, file_id, start_line, end_line, is_exported, is_abstract, extends, implements, doc_comment}
    `;
    await this.db.execute(
      script,
      {
        id: cls.id,
        name: cls.name,
        fileId: cls.fileId,
        startLine: cls.startLine,
        endLine: cls.endLine,
        isExported: cls.isExported,
        isAbstract: cls.isAbstract,
        extends: cls.extends ?? null,
        implements: cls.implements,
        docComment: cls.docComment ?? null,
      },
      tx
    );
  }

  /**
   * Gets a Class by ID.
   */
  async getClass(id: string): Promise<ClassNode | null> {
    const results = await this.db.query<{
      id: string;
      name: string;
      file_id: string;
      start_line: number;
      end_line: number;
      is_exported: boolean;
      is_abstract: boolean;
      extends: string | null;
      implements: string[];
      doc_comment: string | null;
    }>(
      `?[id, name, file_id, start_line, end_line, is_exported, is_abstract, extends, implements, doc_comment] :=
        *class{id, name, file_id, start_line, end_line, is_exported, is_abstract, extends, implements, doc_comment},
        id = $id`,
      { id }
    );
    if (results.length === 0) return null;
    const r = results[0]!;
    return {
      id: r.id,
      name: r.name,
      fileId: r.file_id,
      startLine: r.start_line,
      endLine: r.end_line,
      isExported: r.is_exported,
      isAbstract: r.is_abstract,
      extends: r.extends ?? undefined,
      implements: r.implements,
      docComment: r.doc_comment ?? undefined,
    };
  }

  // ===========================================================================
  // Relationship Operations
  // ===========================================================================

  /**
   * Creates a CONTAINS relationship (File -> Entity).
   */
  async createContains(rel: ContainsRelationship, tx?: Transaction): Promise<void> {
    const script = `
      ?[from_id, to_id, line_number] <- [[$fromId, $toId, $lineNumber]]
      :put contains {from_id, to_id => line_number}
    `;
    await this.db.execute(
      script,
      {
        fromId: rel.fromId,
        toId: rel.toId,
        lineNumber: rel.lineNumber,
      },
      tx
    );
  }

  /**
   * Creates a CALLS relationship (Function -> Function).
   */
  async createCalls(rel: CallsRelationship, tx?: Transaction): Promise<void> {
    const script = `
      ?[from_id, to_id, line_number, is_direct_call, is_await] <- [[$fromId, $toId, $lineNumber, $isDirectCall, $isAwait]]
      :put calls {from_id, to_id => line_number, is_direct_call, is_await}
    `;
    await this.db.execute(
      script,
      {
        fromId: rel.fromId,
        toId: rel.toId,
        lineNumber: rel.lineNumber,
        isDirectCall: rel.isDirectCall,
        isAwait: rel.isAwait,
      },
      tx
    );
  }

  /**
   * Creates an IMPORTS relationship (File -> File).
   */
  async createImports(rel: ImportsRelationship, tx?: Transaction): Promise<void> {
    const script = `
      ?[from_id, to_id, imported_symbols, import_type, is_type_only] <- [[$fromId, $toId, $importedSymbols, $importType, $isTypeOnly]]
      :put imports {from_id, to_id => imported_symbols, import_type, is_type_only}
    `;
    await this.db.execute(
      script,
      {
        fromId: rel.fromId,
        toId: rel.toId,
        importedSymbols: rel.importedSymbols,
        importType: rel.importType,
        isTypeOnly: rel.isTypeOnly,
      },
      tx
    );
  }

  /**
   * Creates an EXTENDS relationship (Class/Interface -> Class/Interface).
   */
  async createExtends(rel: ExtendsRel, tx?: Transaction): Promise<void> {
    const script = `
      ?[from_id, to_id] <- [[$fromId, $toId]]
      :put extends {from_id, to_id}
    `;
    await this.db.execute(
      script,
      {
        fromId: rel.fromId,
        toId: rel.toId,
      },
      tx
    );
  }

  /**
   * Creates an IMPLEMENTS relationship (Class -> Interface).
   */
  async createImplements(rel: ImplementsRelationship, tx?: Transaction): Promise<void> {
    const script = `
      ?[from_id, to_id] <- [[$fromId, $toId]]
      :put implements {from_id, to_id}
    `;
    await this.db.execute(
      script,
      {
        fromId: rel.fromId,
        toId: rel.toId,
      },
      tx
    );
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Batch creates multiple nodes of the same type.
   * Note: CozoDB doesn't have a direct batch insert like this, so we loop.
   */
  async batchCreateNodes<T extends { id: string }>(
    nodeType: NodeName,
    nodes: T[],
    tx?: Transaction
  ): Promise<void> {
    // For now, insert one at a time
    // In the future, could use a more efficient bulk approach
    for (const node of nodes) {
      const keys = Object.keys(node);
      const values = keys.map((k) => `$${k}`).join(", ");
      const fields = keys.join(", ");

      // Build params object
      const params: Record<string, unknown> = {};
      for (const k of keys) {
        params[k] = (node as Record<string, unknown>)[k];
      }

      const script = `
        ?[${fields}] <- [[${values}]]
        :put ${nodeType.toLowerCase()} {${keys[0]} => ${keys.slice(1).join(", ")}}
      `;
      await this.db.execute(script, params, tx);
    }
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Gets the import chain for a file (all files it imports, transitively).
   * Uses recursive CozoScript rules for transitive closure.
   */
  async getImportChain(fileId: string, maxDepth = 10): Promise<FileNode[]> {
    // Use recursive rule for transitive imports
    const results = await this.db.query<{
      id: string;
      path: string;
      relative_path: string;
      extension: string;
    }>(
      `imported[to_id, depth] := *imports{from_id, to_id}, from_id = $fileId, depth = 1
       imported[to_id, depth] := imported[mid, d], d < $maxDepth, *imports{from_id: mid, to_id}, depth = d + 1
       ?[id, path, relative_path, extension] := imported[id, _], *file{id, path, relative_path, extension}`,
      { fileId, maxDepth }
    );
    return results.map((r) => ({
      id: r.id,
      path: r.path,
      relativePath: r.relative_path,
      extension: r.extension,
      hash: "",
      size: 0,
      lastModified: 0,
      language: "",
    }));
  }

  /**
   * Gets files that import a given file.
   */
  async getImporters(fileId: string): Promise<FileNode[]> {
    const results = await this.db.query<{
      id: string;
      path: string;
      relative_path: string;
      extension: string;
    }>(
      `?[id, path, relative_path, extension] :=
        *imports{from_id: id, to_id},
        to_id = $fileId,
        *file{id, path, relative_path, extension}`,
      { fileId }
    );
    return results.map((r) => ({
      id: r.id,
      path: r.path,
      relativePath: r.relative_path,
      extension: r.extension,
      hash: "",
      size: 0,
      lastModified: 0,
      language: "",
    }));
  }

  /**
   * Finds functions by name pattern.
   * Note: CozoDB uses regex for pattern matching with ~
   */
  async findFunctionsByName(pattern: string): Promise<FunctionNode[]> {
    // Use contains check in CozoScript
    const results = await this.db.query<{
      id: string;
      name: string;
      file_id: string;
      start_line: number;
      signature: string;
      is_exported: boolean;
    }>(
      `?[id, name, file_id, start_line, signature, is_exported] :=
        *function{id, name, file_id, start_line, signature, is_exported},
        contains(name, $pattern)`,
      { pattern }
    );
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      fileId: r.file_id,
      startLine: r.start_line,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      signature: r.signature,
      isExported: r.is_exported,
      isAsync: false,
      isGenerator: false,
      complexity: 0,
    }));
  }

  /**
   * Gets complexity statistics.
   */
  async getComplexityStats(): Promise<{
    avgComplexity: number;
    maxComplexity: number;
    highComplexityCount: number;
  }> {
    const results = await this.db.query<{
      avg_complexity: number;
      max_complexity: number;
      high_complexity_count: number;
    }>(
      `stats[avg_c, max_c] := *function{complexity}, avg_c = mean(complexity), max_c = max(complexity)
       high_count[cnt] := cnt = count(id), *function{id, complexity}, complexity > 10
       ?[avg_complexity, max_complexity, high_complexity_count] := stats[avg_complexity, max_complexity], high_count[high_complexity_count]`
    );
    if (results.length === 0) {
      return { avgComplexity: 0, maxComplexity: 0, highComplexityCount: 0 };
    }
    const r = results[0]!;
    return {
      avgComplexity: r.avg_complexity ?? 0,
      maxComplexity: r.max_complexity ?? 0,
      highComplexityCount: r.high_complexity_count ?? 0,
    };
  }

  /**
   * Gets the most called functions.
   */
  async getMostCalledFunctions(limit = 10): Promise<Array<FunctionNode & { callCount: number }>> {
    const results = await this.db.query<{
      id: string;
      name: string;
      file_id: string;
      signature: string;
      call_count: number;
    }>(
      `call_counts[to_id, cnt] := *calls{to_id}, cnt = count(to_id)
       ?[id, name, file_id, signature, call_count] :=
         call_counts[id, call_count],
         *function{id, name, file_id, signature}
       :order -call_count
       :limit $limit`,
      { limit }
    );
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      fileId: r.file_id,
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      signature: r.signature,
      isExported: false,
      isAsync: false,
      isGenerator: false,
      complexity: 0,
      callCount: r.call_count,
    }));
  }

  // ===========================================================================
  // Vector Search Operations
  // ===========================================================================

  /**
   * Search for similar functions using vector embeddings.
   * Requires embeddings to be populated in the function_embedding relation.
   *
   * @param embedding - Query vector (384 dimensions for all-MiniLM-L6-v2)
   * @param k - Number of results to return
   * @returns Functions ordered by similarity (closest first)
   */
  async vectorSearchFunctions(
    embedding: number[],
    k: number = 10
  ): Promise<Array<{ id: string; name: string; fileId: string; distance: number }>> {
    // Join function_embedding with function to get function details
    try {
      const results = await this.db.query<{
        id: string;
        name: string;
        file_id: string;
        distance: number;
      }>(
        `?[id, name, file_id, distance] :=
          *function_embedding{function_id: id, embedding: emb},
          *function{id, name, file_id},
          distance = l2_dist(emb, $embedding)
         :order distance
         :limit $k`,
        { embedding, k }
      );

      return results.map((r) => ({
        id: r.id,
        name: r.name,
        fileId: r.file_id,
        distance: r.distance,
      }));
    } catch {
      // If vector search fails (e.g., no embeddings yet), return empty
      return [];
    }
  }

  /**
   * Update embedding for a function.
   * Stores the embedding in the separate function_embedding relation.
   *
   * @param functionId - Function ID
   * @param embedding - Vector embedding (384 dimensions)
   */
  async updateFunctionEmbedding(
    functionId: string,
    embedding: number[],
    tx?: Transaction
  ): Promise<void> {
    // Insert or update in the function_embedding relation
    const script = `
      ?[function_id, embedding] <- [[$functionId, $embedding]]
      :put function_embedding {function_id => embedding}
    `;
    await this.db.execute(script, { functionId, embedding }, tx);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new GraphOperations instance.
 */
export function createGraphOperations(db: GraphDatabase): GraphOperations {
  return new GraphOperations(db);
}
