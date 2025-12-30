/**
 * Class Entity Extractor
 *
 * Extracts class entities from UCE format into CozoDB-native rows.
 *
 * Features:
 * - Class node with metadata
 * - Method extraction via FunctionExtractor
 * - HAS_METHOD relationship tracking
 * - Unresolved EXTENDS/IMPLEMENTS for Pass 2
 * - Embedding text for semantic search
 *
 * @module
 */

import type { UCEClass } from "../../types/uce.js";
import type {
  ClassRow,
  FunctionRow,
  HasMethodRow,
  UnresolvedTypeRef,
  EmbeddingChunk,
} from "./types.js";
import { generateEntityId } from "./id-generator.js";
import { FunctionExtractor } from "./function-extractor.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of extracting a class.
 */
export interface ClassExtractionResult {
  /** CozoDB row for the class table */
  classRow: ClassRow;
  /** CozoDB rows for method entries (Function table) */
  methodRows: FunctionRow[];
  /** HAS_METHOD relationship rows */
  hasMethodRows: HasMethodRow[];
  /** Embedding chunks for class and methods */
  embeddingChunks: EmbeddingChunk[];
  /** Unresolved EXTENDS reference (class name) */
  unresolvedExtends: string | null;
  /** Unresolved IMPLEMENTS references (interface names) */
  unresolvedImplements: string[];
  /** Unresolved type references from methods */
  unresolvedTypes: UnresolvedTypeRef[];
}

// =============================================================================
// Class Extractor
// =============================================================================

/**
 * Extracts class entities from UCE format.
 *
 * @example
 * ```typescript
 * const extractor = new ClassExtractor();
 * const result = extractor.extract(uceClass, fileId, filePath);
 *
 * // Insert class
 * batch.class.push(result.classRow);
 *
 * // Insert methods
 * batch.function.push(...result.methodRows);
 *
 * // Insert relationships
 * batch.hasMethod.push(...result.hasMethodRows);
 * ```
 */
export class ClassExtractor {
  private functionExtractor: FunctionExtractor;

  constructor() {
    this.functionExtractor = new FunctionExtractor();
  }

  /**
   * Extracts a class into CozoDB row format.
   *
   * @param cls - UCE class entity
   * @param fileId - ID of the containing file
   * @param filePath - Path of the containing file
   */
  extract(cls: UCEClass, fileId: string, filePath: string): ClassExtractionResult {
    // Generate stable class ID
    const classId = generateEntityId(filePath, "class", cls.name);

    // Build class row matching schema order
    const classRow: ClassRow = [
      classId,                              // id
      cls.name,                             // name
      fileId,                               // file_id
      cls.location.startLine,               // start_line
      cls.location.endLine,                 // end_line
      cls.isAbstract,                       // is_abstract
      cls.modifiers.includes("export"),     // is_exported
      cls.extends,                          // extends_class (nullable)
      cls.implements,                       // implements_interfaces
      cls.docComment,                       // doc_comment (nullable)
    ];

    // Extract methods and build relationships
    const methodRows: FunctionRow[] = [];
    const hasMethodRows: HasMethodRow[] = [];
    const embeddingChunks: EmbeddingChunk[] = [];
    const unresolvedTypes: UnresolvedTypeRef[] = [];

    // Add class embedding chunk
    embeddingChunks.push(this.createClassEmbeddingChunk(cls, classId, filePath));

    // Extract regular methods
    for (const method of cls.methods) {
      const result = this.functionExtractor.extractMethod(
        method,
        fileId,
        filePath,
        cls.name
      );

      methodRows.push(result.row);
      embeddingChunks.push(result.embeddingChunk);
      unresolvedTypes.push(...result.unresolvedTypes);

      // HAS_METHOD relationship
      const hasMethodRow: HasMethodRow = [
        classId,                            // from_id
        result.row[0],                      // to_id (method id)
        result.visibility,                  // visibility
        result.isStatic,                    // is_static
        result.isAbstract,                  // is_abstract
      ];
      hasMethodRows.push(hasMethodRow);
    }

    // Extract constructor if present
    if (cls.constructor) {
      const ctorResult = this.functionExtractor.extractMethod(
        cls.constructor,
        fileId,
        filePath,
        cls.name
      );

      methodRows.push(ctorResult.row);
      embeddingChunks.push(ctorResult.embeddingChunk);
      unresolvedTypes.push(...ctorResult.unresolvedTypes);

      // HAS_METHOD for constructor
      const ctorHasMethodRow: HasMethodRow = [
        classId,
        ctorResult.row[0],
        "public",
        false,
        false,
      ];
      hasMethodRows.push(ctorHasMethodRow);
    }

    return {
      classRow,
      methodRows,
      hasMethodRows,
      embeddingChunks,
      unresolvedExtends: cls.extends,
      unresolvedImplements: cls.implements,
      unresolvedTypes,
    };
  }

  // ===========================================================================
  // Embedding Preparation
  // ===========================================================================

  /**
   * Creates embedding chunk for a class.
   */
  private createClassEmbeddingChunk(
    cls: UCEClass,
    classId: string,
    filePath: string
  ): EmbeddingChunk {
    const parts: string[] = [];

    parts.push(`Class: ${cls.name}`);

    if (cls.isAbstract) {
      parts.push("Abstract class");
    }

    if (cls.extends) {
      parts.push(`Extends: ${cls.extends}`);
    }

    if (cls.implements.length > 0) {
      parts.push(`Implements: ${cls.implements.join(", ")}`);
    }

    if (cls.docComment) {
      const cleanDoc = cls.docComment
        .replace(/\/\*\*|\*\/|\n\s*\*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      parts.push(`Documentation: ${cleanDoc}`);
    }

    // List methods
    if (cls.methods.length > 0) {
      const methodList = cls.methods
        .map((m) => `${m.visibility} ${m.isStatic ? "static " : ""}${m.name}()`)
        .join(", ");
      parts.push(`Methods: ${methodList}`);
    }

    // List properties
    if (cls.properties.length > 0) {
      const propList = cls.properties
        .map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`)
        .join(", ");
      parts.push(`Properties: ${propList}`);
    }

    return {
      entityId: classId,
      entityType: "class",
      text: parts.join("\n"),
      metadata: {
        name: cls.name,
        filePath,
      },
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a ClassExtractor instance.
 */
export function createClassExtractor(): ClassExtractor {
  return new ClassExtractor();
}
