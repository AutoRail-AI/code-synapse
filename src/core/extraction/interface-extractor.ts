/**
 * Interface Entity Extractor
 *
 * Extracts interface and type alias entities from UCE format into CozoDB-native rows.
 *
 * Features:
 * - Interface properties stored as native JSON
 * - Type alias definitions
 * - EXTENDS_INTERFACE relationship tracking
 * - Embedding text for semantic search
 *
 * @module
 */

import type { UCEInterface, UCETypeAlias } from "../../types/uce.js";
import type {
  InterfaceRow,
  TypeAliasRow,
  EmbeddingChunk,
} from "./types.js";
import { generateEntityId } from "./id-generator.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of extracting an interface.
 */
export interface InterfaceExtractionResult {
  /** CozoDB row for the interface table */
  row: InterfaceRow;
  /** Embedding chunk for semantic search */
  embeddingChunk: EmbeddingChunk;
  /** Unresolved EXTENDS_INTERFACE references (interface names) */
  unresolvedExtends: string[];
}

/**
 * Result of extracting a type alias.
 */
export interface TypeAliasExtractionResult {
  /** CozoDB row for the type_alias table */
  row: TypeAliasRow;
  /** Embedding chunk for semantic search */
  embeddingChunk: EmbeddingChunk;
}

// =============================================================================
// Interface Extractor
// =============================================================================

/**
 * Extracts interface and type alias entities from UCE format.
 *
 * @example
 * ```typescript
 * const extractor = new InterfaceExtractor();
 *
 * // Interface
 * const ifaceResult = extractor.extractInterface(uceInterface, fileId, filePath);
 * batch.interface.push(ifaceResult.row);
 *
 * // Type alias
 * const typeResult = extractor.extractTypeAlias(uceTypeAlias, fileId, filePath);
 * batch.typeAlias.push(typeResult.row);
 * ```
 */
export class InterfaceExtractor {
  /**
   * Extracts an interface into CozoDB row format.
   *
   * @param iface - UCE interface entity
   * @param fileId - ID of the containing file
   * @param filePath - Path of the containing file
   */
  extractInterface(
    iface: UCEInterface,
    fileId: string,
    filePath: string
  ): InterfaceExtractionResult {
    // Generate stable interface ID
    const interfaceId = generateEntityId(filePath, "interface", iface.name);

    // Convert properties to JSON-friendly format
    const propertiesJson = iface.properties.length > 0
      ? this.propertiesToJson(iface.properties)
      : null;

    // Build interface row matching schema order
    const row: InterfaceRow = [
      interfaceId,                          // id
      iface.name,                           // name
      fileId,                               // file_id
      iface.location.startLine,             // start_line
      iface.location.endLine,               // end_line
      iface.modifiers.includes("export"),   // is_exported
      iface.extends,                        // extends_interfaces
      iface.docComment,                     // doc_comment (nullable)
      propertiesJson,                       // properties (JSON, nullable)
    ];

    // Create embedding chunk
    const embeddingChunk = this.createInterfaceEmbeddingChunk(
      iface,
      interfaceId,
      filePath
    );

    return {
      row,
      embeddingChunk,
      unresolvedExtends: iface.extends,
    };
  }

  /**
   * Extracts a type alias into CozoDB row format.
   *
   * @param typeAlias - UCE type alias entity
   * @param fileId - ID of the containing file
   * @param filePath - Path of the containing file
   */
  extractTypeAlias(
    typeAlias: UCETypeAlias,
    fileId: string,
    filePath: string
  ): TypeAliasExtractionResult {
    // Generate stable type alias ID
    const typeAliasId = generateEntityId(filePath, "typeAlias", typeAlias.name);

    // Build type alias row matching schema order
    const row: TypeAliasRow = [
      typeAliasId,                              // id
      typeAlias.name,                           // name
      fileId,                                   // file_id
      typeAlias.location.startLine,             // start_line
      typeAlias.location.endLine,               // end_line
      typeAlias.modifiers.includes("export"),   // is_exported
      typeAlias.typeDefinition,                 // type_definition
      typeAlias.docComment,                     // doc_comment (nullable)
    ];

    // Create embedding chunk
    const embeddingChunk = this.createTypeAliasEmbeddingChunk(
      typeAlias,
      typeAliasId,
      filePath
    );

    return {
      row,
      embeddingChunk,
    };
  }

  // ===========================================================================
  // JSON Conversion
  // ===========================================================================

  /**
   * Converts interface properties to JSON string for CozoDB storage.
   */
  private propertiesToJson(
    properties: UCEInterface["properties"]
  ): string {
    const result: Array<{
      name: string;
      type: string | null;
      isOptional: boolean;
      isReadonly: boolean;
      docComment: string | null;
    }> = [];

    for (const prop of properties) {
      result.push({
        name: prop.name,
        type: prop.type,
        isOptional: prop.isOptional,
        isReadonly: prop.isReadonly,
        docComment: prop.docComment,
      });
    }

    return JSON.stringify(result);
  }

  // ===========================================================================
  // Embedding Preparation
  // ===========================================================================

  /**
   * Creates embedding chunk for an interface.
   */
  private createInterfaceEmbeddingChunk(
    iface: UCEInterface,
    interfaceId: string,
    filePath: string
  ): EmbeddingChunk {
    const parts: string[] = [];

    parts.push(`Interface: ${iface.name}`);

    if (iface.extends.length > 0) {
      parts.push(`Extends: ${iface.extends.join(", ")}`);
    }

    if (iface.docComment) {
      const cleanDoc = iface.docComment
        .replace(/\/\*\*|\*\/|\n\s*\*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      parts.push(`Documentation: ${cleanDoc}`);
    }

    // List properties
    if (iface.properties.length > 0) {
      const propList = iface.properties
        .map((p) => {
          const optional = p.isOptional ? "?" : "";
          const readonly = p.isReadonly ? "readonly " : "";
          return `${readonly}${p.name}${optional}${p.type ? `: ${p.type}` : ""}`;
        })
        .join("; ");
      parts.push(`Properties: { ${propList} }`);
    }

    // List methods
    if (iface.methods.length > 0) {
      const methodList = iface.methods
        .map((m) => m.signature)
        .join("; ");
      parts.push(`Methods: ${methodList}`);
    }

    return {
      entityId: interfaceId,
      entityType: "interface",
      text: parts.join("\n"),
      metadata: {
        name: iface.name,
        filePath,
      },
    };
  }

  /**
   * Creates embedding chunk for a type alias.
   */
  private createTypeAliasEmbeddingChunk(
    typeAlias: UCETypeAlias,
    typeAliasId: string,
    filePath: string
  ): EmbeddingChunk {
    const parts: string[] = [];

    parts.push(`Type: ${typeAlias.name}`);
    parts.push(`Definition: ${typeAlias.typeDefinition}`);

    if (typeAlias.docComment) {
      const cleanDoc = typeAlias.docComment
        .replace(/\/\*\*|\*\/|\n\s*\*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      parts.push(`Documentation: ${cleanDoc}`);
    }

    return {
      entityId: typeAliasId,
      entityType: "typeAlias",
      text: parts.join("\n"),
      metadata: {
        name: typeAlias.name,
        filePath,
      },
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates an InterfaceExtractor instance.
 */
export function createInterfaceExtractor(): InterfaceExtractor {
  return new InterfaceExtractor();
}
