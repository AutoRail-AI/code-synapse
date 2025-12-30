/**
 * Entity ID Generator
 *
 * Generates deterministic, collision-resistant IDs for graph entities.
 *
 * Key Design: Signature-based IDs (NOT line-based)
 *
 * Why NOT use line numbers:
 * - Adding a newline at the top of a file would change ALL entity IDs below
 * - This breaks all relationships and makes incremental updates impossible
 * - History/versioning becomes unreliable
 *
 * Why use signatures:
 * - Moving a function to a different line keeps the same ID
 * - Renaming a function creates a NEW ID (correct behavior)
 * - Overloads can be distinguished by parameter signature
 *
 * ID Format: SHA-256 hash truncated to 16 hex chars
 * Input: filePath:entityKind:parentScope:name:disambiguator
 *
 * @module
 */

import { createHash } from "node:crypto";

// =============================================================================
// Core ID Generation
// =============================================================================

/**
 * Generates a stable entity ID based on semantic identity.
 *
 * The ID remains stable when:
 * - The entity is moved to a different line
 * - The file is reformatted
 * - Comments are added/removed
 *
 * The ID changes when:
 * - The entity is renamed
 * - The entity is moved to a different file
 * - The signature changes (for overload disambiguation)
 *
 * @param filePath - Absolute file path
 * @param entityKind - 'function' | 'class' | 'interface' | 'variable' | 'method'
 * @param name - Entity name
 * @param parentScope - Parent scope name (e.g., class name for methods)
 * @param disambiguator - For overloads: parameter signature hash
 */
export function generateEntityId(
  filePath: string,
  entityKind: string,
  name: string,
  parentScope: string = "",
  disambiguator: string = ""
): string {
  // Normalize file path (handle Windows paths)
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Build identity string
  // Format: filePath:kind:scope:name:disambiguator
  const parts = [normalizedPath, entityKind, parentScope, name, disambiguator].filter(
    (p) => p.length > 0
  );
  const input = parts.join(":");

  return hashToId(input);
}

/**
 * Generates a file ID from absolute path.
 * File IDs are stable as long as the file path doesn't change.
 */
export function generateFileId(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return hashToId(`file:${normalizedPath}`);
}

/**
 * Generates a ghost node ID for external dependencies.
 * Ghost IDs are based on package + export name.
 */
export function generateGhostId(packageName: string, exportName: string): string {
  return hashToId(`ghost:${packageName}:${exportName}`);
}

/**
 * Generates a module ID from directory path.
 */
export function generateModuleId(directory: string): string {
  const normalizedPath = directory.replace(/\\/g, "/");
  return hashToId(`module:${normalizedPath}`);
}

// =============================================================================
// Disambiguation Helpers
// =============================================================================

/**
 * Creates a disambiguator from function parameters.
 * Used to distinguish overloaded functions with the same name.
 *
 * @example
 * // function foo(x: number): void
 * createParamDisambiguator([{ name: 'x', type: 'number' }]) // => 'x:number'
 *
 * // function foo(x: string, y: boolean): void
 * createParamDisambiguator([{ name: 'x', type: 'string' }, { name: 'y', type: 'boolean' }])
 * // => 'x:string,y:boolean'
 */
export function createParamDisambiguator(
  params: Array<{ name: string; type: string | null }>
): string {
  if (params.length === 0) return "";

  return params.map((p) => `${p.name}:${p.type || "any"}`).join(",");
}

/**
 * Creates a disambiguator from a full signature.
 * Useful when you have the raw signature string.
 *
 * @example
 * createSignatureDisambiguator('function foo(x: number): void') // => hash of signature
 */
export function createSignatureDisambiguator(signature: string): string {
  // Hash the signature to create a short disambiguator
  // This handles complex cases like generics, callbacks, etc.
  return createHash("sha256").update(signature).digest("hex").slice(0, 8);
}

// =============================================================================
// Qualified Name Builders
// =============================================================================

/**
 * Builds a qualified name for symbol lookup.
 * Used in the SymbolRegistry for cross-file resolution.
 *
 * @example
 * buildQualifiedName('/src/utils.ts', 'function', 'formatDate')
 * // => '/src/utils.ts#function:formatDate'
 *
 * buildQualifiedName('/src/user.ts', 'method', 'validate', 'UserService')
 * // => '/src/user.ts#method:UserService.validate'
 */
export function buildQualifiedName(
  filePath: string,
  kind: string,
  name: string,
  parentScope: string = ""
): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const scopedName = parentScope ? `${parentScope}.${name}` : name;
  return `${normalizedPath}#${kind}:${scopedName}`;
}

/**
 * Parses a qualified name back to its components.
 */
export function parseQualifiedName(qualifiedName: string): {
  filePath: string;
  kind: string;
  name: string;
  parentScope: string | null;
} | null {
  const match = qualifiedName.match(/^(.+)#(\w+):(?:(\w+)\.)?(\w+)$/);
  if (!match) return null;

  const [, filePath, kind, parentScope, name] = match;
  return {
    filePath: filePath ?? "",
    kind: kind ?? "",
    name: name ?? "",
    parentScope: parentScope ?? null,
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Hashes input string to a 16-character hex ID.
 */
function hashToId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// =============================================================================
// ID Validation
// =============================================================================

/**
 * Validates that a string is a valid entity ID.
 * IDs are 16 lowercase hex characters.
 */
export function isValidEntityId(id: string): boolean {
  return /^[a-f0-9]{16}$/.test(id);
}

/**
 * Extracts entity kind from a qualified name if present in ID generation input.
 * Note: This is heuristic since IDs are hashed.
 */
export function isLikelyFileId(id: string): boolean {
  // File IDs are generated from 'file:' prefix
  // We can't reverse the hash, but we can check format
  return isValidEntityId(id);
}
