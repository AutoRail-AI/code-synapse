/**
 * Function Entity Extractor
 *
 * Extracts function entities from UCE format into CozoDB-native rows.
 *
 * Features:
 * - Signature-based ID generation (stable across line changes)
 * - Embedding text preparation for vector search
 * - Unresolved call tracking for Pass 2 resolution
 * - Method extraction for class members
 *
 * @module
 */

import type {
  UCEFunction,
  UCEMethod,
} from "../../types/uce.js";
import type {
  FunctionRow,
  UnresolvedCall,
  UnresolvedTypeRef,
  EmbeddingChunk,
} from "./types.js";
import {
  generateEntityId,
  createParamDisambiguator,
} from "./id-generator.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of extracting a function.
 */
export interface FunctionExtractionResult {
  /** CozoDB row for the function table */
  row: FunctionRow;
  /** Text chunk for vector embedding */
  embeddingChunk: EmbeddingChunk;
  /** Unresolved function calls within this function */
  unresolvedCalls: UnresolvedCall[];
  /** Unresolved type references (params, return type) */
  unresolvedTypes: UnresolvedTypeRef[];
}

/**
 * Result of extracting a method.
 */
export interface MethodExtractionResult extends FunctionExtractionResult {
  /** Method visibility for HAS_METHOD relationship */
  visibility: "public" | "private" | "protected";
  /** Whether the method is static */
  isStatic: boolean;
  /** Whether the method is abstract */
  isAbstract: boolean;
}

// =============================================================================
// Function Extractor Class
// =============================================================================

/**
 * Extracts function entities from UCE format.
 *
 * @example
 * ```typescript
 * const extractor = new FunctionExtractor();
 * const result = extractor.extract(uceFunction, fileId);
 *
 * // Insert into CozoDB
 * batch.function.push(result.row);
 *
 * // Queue for embedding
 * embeddingQueue.push(result.embeddingChunk);
 * ```
 */
export class FunctionExtractor {
  /**
   * Extracts a top-level function into CozoDB row format.
   *
   * @param fn - UCE function entity
   * @param fileId - ID of the containing file
   * @param filePath - Path of the containing file (for ID generation)
   */
  extract(fn: UCEFunction, fileId: string, filePath: string): FunctionExtractionResult {
    // Generate stable ID using signature (not line number)
    const disambiguator = createParamDisambiguator(
      fn.params.map((p) => ({ name: p.name, type: p.type }))
    );
    const id = generateEntityId(filePath, "function", fn.name, fn.parentScope || "", disambiguator);

    // Prepare text for vector embedding
    const embeddingText = this.prepareEmbeddingText(fn);

    // Build CozoDB row matching schema order
    const row: FunctionRow = [
      id,                                           // id
      fn.name,                                      // name
      fileId,                                       // file_id
      fn.location.startLine,                        // start_line
      fn.location.endLine,                          // end_line
      fn.location.startColumn,                      // start_column
      fn.location.endColumn,                        // end_column
      fn.signature,                                 // signature
      fn.returnType,                                // return_type (nullable)
      fn.modifiers.includes("export"),              // is_exported
      fn.modifiers.includes("async"),               // is_async
      this.isGenerator(fn),                         // is_generator
      fn.complexity,                                // complexity
      fn.params.length,                             // parameter_count
      fn.docComment,                                // doc_comment (nullable)
      embeddingText,                                // business_logic (text for embedding)
      null,                                         // inference_confidence (set later)
    ];

    // Extract unresolved type references
    const unresolvedTypes = this.extractTypeReferences(fn, id);

    // Create embedding chunk
    const embeddingChunk: EmbeddingChunk = {
      entityId: id,
      entityType: "function",
      text: embeddingText,
      metadata: {
        name: fn.name,
        filePath,
        signature: fn.signature,
      },
    };

    return {
      row,
      embeddingChunk,
      unresolvedCalls: [], // Calls are extracted separately via CallExtractor
      unresolvedTypes,
    };
  }

  /**
   * Extracts a class method into CozoDB row format.
   *
   * @param method - UCE method entity
   * @param fileId - ID of the containing file
   * @param filePath - Path of the containing file
   * @param className - Name of the containing class (parent scope)
   */
  extractMethod(
    method: UCEMethod,
    fileId: string,
    filePath: string,
    className: string
  ): MethodExtractionResult {
    // Generate stable ID with class as parent scope
    const disambiguator = createParamDisambiguator(
      method.params.map((p) => ({ name: p.name, type: p.type }))
    );
    const id = generateEntityId(filePath, "method", method.name, className, disambiguator);

    // Prepare text for vector embedding
    const embeddingText = this.prepareMethodEmbeddingText(method, className);

    // Build CozoDB row
    const row: FunctionRow = [
      id,                                           // id
      method.name,                                  // name
      fileId,                                       // file_id
      method.location.startLine,                    // start_line
      method.location.endLine,                      // end_line
      method.location.startColumn,                  // start_column
      method.location.endColumn,                    // end_column
      method.signature,                             // signature
      method.returnType,                            // return_type (nullable)
      false,                                        // is_exported (methods via class)
      method.modifiers.includes("async"),           // is_async
      this.isMethodGenerator(method),               // is_generator
      1,                                            // complexity (TODO: calculate)
      method.params.length,                         // parameter_count
      method.docComment,                            // doc_comment (nullable)
      embeddingText,                                // business_logic
      null,                                         // inference_confidence
    ];

    // Extract unresolved type references
    const unresolvedTypes = this.extractMethodTypeReferences(method, id);

    // Create embedding chunk
    const embeddingChunk: EmbeddingChunk = {
      entityId: id,
      entityType: "method",
      text: embeddingText,
      metadata: {
        name: `${className}.${method.name}`,
        filePath,
        signature: method.signature,
      },
    };

    return {
      row,
      embeddingChunk,
      unresolvedCalls: [],
      unresolvedTypes,
      visibility: method.visibility,
      isStatic: method.isStatic,
      isAbstract: method.isAbstract,
    };
  }

  // ===========================================================================
  // Embedding Text Preparation
  // ===========================================================================

  /**
   * Prepares text content for vector embedding.
   *
   * Combines:
   * - Function signature (most important)
   * - JSDoc/documentation
   * - First ~200 chars of body (context)
   *
   * This text will be embedded by a background worker for semantic search.
   */
  private prepareEmbeddingText(fn: UCEFunction): string {
    const parts: string[] = [];

    // Signature is the primary identifier
    parts.push(`Function: ${fn.name}`);
    parts.push(`Signature: ${fn.signature}`);

    // Documentation provides context
    if (fn.docComment) {
      // Clean up JSDoc formatting
      const cleanDoc = fn.docComment
        .replace(/\/\*\*|\*\/|\n\s*\*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      parts.push(`Documentation: ${cleanDoc}`);
    }

    // Body snippet for additional context
    if (fn.body && fn.body.length > 0) {
      const bodySnippet = fn.body.slice(0, 300).trim();
      parts.push(`Body: ${bodySnippet}${fn.body.length > 300 ? "..." : ""}`);
    }

    // Parameters with types
    if (fn.params.length > 0) {
      const paramStr = fn.params
        .map((p) => `${p.name}${p.type ? `: ${p.type}` : ""}`)
        .join(", ");
      parts.push(`Parameters: ${paramStr}`);
    }

    // Return type
    if (fn.returnType) {
      parts.push(`Returns: ${fn.returnType}`);
    }

    return parts.join("\n");
  }

  /**
   * Prepares embedding text for a method with class context.
   */
  private prepareMethodEmbeddingText(method: UCEMethod, className: string): string {
    const parts: string[] = [];

    parts.push(`Method: ${className}.${method.name}`);
    parts.push(`Signature: ${method.signature}`);

    if (method.visibility !== "public") {
      parts.push(`Visibility: ${method.visibility}`);
    }

    if (method.isStatic) {
      parts.push("Static method");
    }

    if (method.isAbstract) {
      parts.push("Abstract method");
    }

    if (method.docComment) {
      const cleanDoc = method.docComment
        .replace(/\/\*\*|\*\/|\n\s*\*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      parts.push(`Documentation: ${cleanDoc}`);
    }

    if (method.body && method.body.length > 0) {
      const bodySnippet = method.body.slice(0, 200).trim();
      parts.push(`Body: ${bodySnippet}${method.body.length > 200 ? "..." : ""}`);
    }

    return parts.join("\n");
  }

  // ===========================================================================
  // Type Reference Extraction
  // ===========================================================================

  /**
   * Extracts unresolved type references for USES_TYPE relationships.
   * These are resolved in Pass 2 when we have a complete symbol registry.
   */
  private extractTypeReferences(fn: UCEFunction, functionId: string): UnresolvedTypeRef[] {
    const refs: UnresolvedTypeRef[] = [];

    // Parameter types
    for (const param of fn.params) {
      if (param.type && !this.isPrimitiveType(param.type)) {
        refs.push({
          sourceId: functionId,
          typeName: this.extractTypeName(param.type),
          context: "parameter",
          parameterName: param.name,
        });
      }
    }

    // Return type
    if (fn.returnType && !this.isPrimitiveType(fn.returnType)) {
      refs.push({
        sourceId: functionId,
        typeName: this.extractTypeName(fn.returnType),
        context: "return",
        parameterName: null,
      });
    }

    // Generic type parameters (constraints)
    for (const typeParam of fn.typeParams) {
      if (typeParam.constraint && !this.isPrimitiveType(typeParam.constraint)) {
        refs.push({
          sourceId: functionId,
          typeName: this.extractTypeName(typeParam.constraint),
          context: "generic",
          parameterName: typeParam.name,
        });
      }
    }

    return refs;
  }

  /**
   * Extracts type references from a method.
   */
  private extractMethodTypeReferences(method: UCEMethod, methodId: string): UnresolvedTypeRef[] {
    const refs: UnresolvedTypeRef[] = [];

    for (const param of method.params) {
      if (param.type && !this.isPrimitiveType(param.type)) {
        refs.push({
          sourceId: methodId,
          typeName: this.extractTypeName(param.type),
          context: "parameter",
          parameterName: param.name,
        });
      }
    }

    if (method.returnType && !this.isPrimitiveType(method.returnType)) {
      refs.push({
        sourceId: methodId,
        typeName: this.extractTypeName(method.returnType),
        context: "return",
        parameterName: null,
      });
    }

    return refs;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Checks if a function is a generator (function* or async generator).
   */
  private isGenerator(fn: UCEFunction): boolean {
    return fn.signature.includes("function*") || fn.signature.includes("*");
  }

  /**
   * Checks if a method is a generator.
   */
  private isMethodGenerator(method: UCEMethod): boolean {
    return method.signature.includes("*");
  }

  /**
   * Checks if a type is a primitive (no USES_TYPE relationship needed).
   */
  private isPrimitiveType(type: string): boolean {
    const primitives = new Set([
      "string",
      "number",
      "boolean",
      "void",
      "undefined",
      "null",
      "never",
      "any",
      "unknown",
      "bigint",
      "symbol",
      "object",
      // Common aliases
      "String",
      "Number",
      "Boolean",
      "Object",
    ]);

    // Extract base type (handle generics like Array<string>)
    const parts = type.split("<");
    const baseType = (parts[0] ?? type).trim();
    return primitives.has(baseType);
  }

  /**
   * Extracts the main type name from a complex type.
   *
   * @example
   * extractTypeName('Array<User>') => 'Array'
   * extractTypeName('Promise<Response>') => 'Promise'
   * extractTypeName('User | null') => 'User'
   * extractTypeName('Record<string, Value>') => 'Record'
   */
  private extractTypeName(type: string): string {
    // Handle generics: Array<T> -> Array
    if (type.includes("<")) {
      const parts = type.split("<");
      return (parts[0] ?? type).trim();
    }

    // Handle union types: A | B -> A
    if (type.includes("|")) {
      const parts = type.split("|");
      return (parts[0] ?? type).trim();
    }

    // Handle intersection types: A & B -> A
    if (type.includes("&")) {
      const parts = type.split("&");
      return (parts[0] ?? type).trim();
    }

    // Handle array shorthand: T[] -> T
    if (type.endsWith("[]")) {
      return type.slice(0, -2).trim();
    }

    return type.trim();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a FunctionExtractor instance.
 */
export function createFunctionExtractor(): FunctionExtractor {
  return new FunctionExtractor();
}
