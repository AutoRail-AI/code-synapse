/**
 * Schema Generator
 *
 * Generates CozoScript statements and TypeScript interfaces from the schema definitions.
 * Ensures consistency between database schema and application types.
 *
 * @module
 */

import {
  SCHEMA,
  SCHEMA_VERSION,
  type PropertyDefinition,
  type PropertyType,
  type NodeName,
  type RelationshipName,
} from "./schema-definitions.js";

// =============================================================================
// Type Mapping
// =============================================================================

/**
 * Maps schema property types to CozoDB types
 */
const COZO_TYPE_MAP: Record<PropertyType, string> = {
  STRING: "String",
  INT32: "Int",
  INT64: "Int",
  FLOAT: "Float",
  DOUBLE: "Float",
  BOOLEAN: "Bool",
  TIMESTAMP: "Int", // Unix timestamp in milliseconds
  "STRING[]": "[String]",
  JSON: "Json",
  VECTOR_384: "<F32; 384>", // 384-dimensional vector for all-MiniLM-L6-v2
  VECTOR_768: "<F32; 768>", // 768-dimensional vector for all-mpnet-base-v2
};

/**
 * Maps schema property types to TypeScript types
 */
const TS_TYPE_MAP: Record<PropertyType, string> = {
  STRING: "string",
  INT32: "number",
  INT64: "number",
  FLOAT: "number",
  DOUBLE: "number",
  BOOLEAN: "boolean",
  TIMESTAMP: "number", // Unix timestamp for CozoDB compatibility
  "STRING[]": "string[]",
  JSON: "Record<string, unknown>",
  VECTOR_384: "number[]",
  VECTOR_768: "number[]",
};

// =============================================================================
// CozoScript DDL Generation
// =============================================================================

/**
 * Converts camelCase to snake_case (for property names)
 * Example: startLine -> start_line
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Converts PascalCase or UPPER_SNAKE_CASE to snake_case (for relation names)
 * Examples:
 *   TypeAlias -> type_alias
 *   GhostNode -> ghost_node
 *   CONTAINS -> contains
 *   HAS_METHOD -> has_method
 */
function pascalToSnakeCase(str: string): string {
  // Check if string is UPPER_SNAKE_CASE (all uppercase with underscores)
  if (str === str.toUpperCase() && str.includes("_")) {
    // Already snake_case, just lowercase it
    return str.toLowerCase();
  }
  // Check if string is ALL_CAPS (all uppercase without underscores)
  if (str === str.toUpperCase()) {
    return str.toLowerCase();
  }
  // Otherwise it's PascalCase - convert to snake_case
  return str
    .replace(/([A-Z])/g, (match, _, offset) => (offset > 0 ? "_" : "") + match.toLowerCase())
    .toLowerCase();
}

/**
 * Checks if a type is a vector type
 */
function isVectorType(type: PropertyType): boolean {
  return type === "VECTOR_384" || type === "VECTOR_768";
}

/**
 * Generates a CozoScript :create statement for a node type (stored relation)
 *
 * CozoDB syntax: :create relation_name { key_fields => dependent_fields }
 */
function generateNodeRelation(
  nodeName: string,
  properties: Record<string, PropertyDefinition>
): string {
  const keyFields: string[] = [];
  const dependentFields: string[] = [];

  for (const [propName, propDef] of Object.entries(properties)) {
    const cozoType = COZO_TYPE_MAP[propDef.type];
    // Convert camelCase to snake_case for CozoDB
    const snakeName = toSnakeCase(propName);

    if (propDef.primary) {
      keyFields.push(`${snakeName}: ${cozoType}`);
    } else {
      // Use Type? syntax for nullable fields (CozoDB nullable type marker)
      // Note: Vector types don't support nullable in CozoDB, so skip them
      if (propDef.nullable && !isVectorType(propDef.type)) {
        dependentFields.push(`${snakeName}: ${cozoType}?`);
      } else {
        dependentFields.push(`${snakeName}: ${cozoType}`);
      }
    }
  }

  // Ensure at least one key field (use 'id' as default)
  if (keyFields.length === 0) {
    // Move 'id' from dependent to key if it exists
    const idIndex = dependentFields.findIndex((f) => f.startsWith("id:"));
    if (idIndex >= 0) {
      const [idField] = dependentFields.splice(idIndex, 1);
      if (idField) {
        keyFields.push(idField);
      }
    }
  }

  const keyPart = keyFields.join(",\n    ");
  const depPart = dependentFields.join(",\n    ");

  // Use snake_case relation names for CozoDB convention
  const relationName = pascalToSnakeCase(nodeName);

  if (dependentFields.length > 0) {
    return `:create ${relationName} {
    ${keyPart}
    =>
    ${depPart}
}`;
  } else {
    return `:create ${relationName} {
    ${keyPart}
}`;
  }
}

/**
 * Generates a CozoScript :create statement for a relationship type
 *
 * In CozoDB, relationships are stored relations with from_id and to_id fields
 */
function generateRelationshipRelation(
  relName: string,
  _from: readonly string[],
  _to: readonly string[],
  properties: Record<string, PropertyDefinition>
): string {
  // Key fields: from_id and to_id
  const keyFields = ["from_id: String", "to_id: String"];

  // Dependent fields from properties
  const dependentFields: string[] = [];
  for (const [propName, propDef] of Object.entries(properties)) {
    const cozoType = COZO_TYPE_MAP[propDef.type];
    // Convert camelCase to snake_case
    const snakeName = toSnakeCase(propName);
    // Use Type? syntax for nullable fields
    if (propDef.nullable && !isVectorType(propDef.type)) {
      dependentFields.push(`${snakeName}: ${cozoType}?`);
    } else {
      dependentFields.push(`${snakeName}: ${cozoType}`);
    }
  }

  const keyPart = keyFields.join(",\n    ");

  // Use snake_case for relation names
  const relationName = pascalToSnakeCase(relName);

  if (dependentFields.length > 0) {
    const depPart = dependentFields.join(",\n    ");
    return `:create ${relationName} {
    ${keyPart}
    =>
    ${depPart}
}`;
  } else {
    return `:create ${relationName} {
    ${keyPart}
}`;
  }
}

/**
 * Generates the schema version relation for tracking migrations.
 * Note: Named 'schema_version' (not '_schema_version') because
 * CozoDB treats underscore-prefixed relations as system/hidden.
 */
function generateSchemaVersionRelation(): string {
  return `:create schema_version {
    id: String
    =>
    version: Int,
    updated_at: Float
}`;
}

/**
 * Generates all CozoScript statements for the complete schema
 *
 * @returns Array of CozoScript statements to create the schema
 */
export function generateCozoScript(): string[] {
  const statements: string[] = [];

  // Add header comment (as a comment line that will be skipped)
  statements.push(`# Code-Synapse Graph Schema v${SCHEMA_VERSION}`);
  statements.push(`# Generated at ${new Date().toISOString()}`);
  statements.push("");

  // Generate schema version relation first
  statements.push("# Schema Version Tracking");
  statements.push(generateSchemaVersionRelation());
  statements.push("");

  // Generate node relations
  statements.push("# Node Relations");
  for (const [nodeName, properties] of Object.entries(SCHEMA.nodes)) {
    // Skip internal _SchemaVersion node as we handle it separately
    if (nodeName === "_SchemaVersion") continue;
    statements.push(
      generateNodeRelation(nodeName, properties as Record<string, PropertyDefinition>)
    );
    statements.push("");
  }

  // Generate relationship relations
  statements.push("# Relationship Relations");
  for (const [relName, relDef] of Object.entries(SCHEMA.relationships)) {
    const { from, to, properties } = relDef as {
      from: readonly string[];
      to: readonly string[];
      properties: Record<string, PropertyDefinition>;
    };
    statements.push(generateRelationshipRelation(relName, from, to, properties));
    statements.push("");
  }

  return statements.filter((s) => s.length > 0);
}

/**
 * Tables added in V13+ that have their own migrations.
 * These tables use PascalCase naming and are created by migrations 003-005.
 * Excluding them from generateExecutableCozoScript() to avoid naming conflicts.
 */
const V13_PLUS_TABLES = new Set([
  // V13 - Justification Layer
  "Justification",
  "ClarificationQuestion",
  "ProjectContext",
  // V14 - Classification Layer
  "EntityClassification",
  // V15 - Ledger & Adaptive Indexing
  "LedgerEntry",
  "AdaptiveSession",
  "ObservedQuery",
  "ObservedChange",
  "SemanticCorrelation",
  "AdaptiveReindexRequest",
  "IndexingPriority",
]);

/**
 * Relationships added in V13+ that have their own migrations.
 */
const V13_PLUS_RELATIONSHIPS = new Set([
  // V13 - Justification Layer
  "HAS_JUSTIFICATION",
  "JUSTIFICATION_HIERARCHY",
  "HAS_CLARIFICATION",
  // V14 - Classification Layer
  "HAS_CLASSIFICATION",
  "CLASSIFICATION_DEPENDS_ON",
  // V15 - Adaptive Indexing
  "QUERY_RETURNED",
  "CHANGE_AFFECTED",
  "CORRELATION_QUERY",
  "CORRELATION_CHANGE",
  "SESSION_QUERY",
  "SESSION_CHANGE",
]);

/**
 * Generates executable CozoScript statements (without comments)
 *
 * Note: Does NOT include schema_version relation - that is managed by MigrationRunner.
 * Note: Does NOT include V13+ tables/relationships - those use PascalCase naming
 *       and are created by their own migrations (003-005).
 *
 * @returns Array of executable CozoScript statements
 */
export function generateExecutableCozoScript(): string[] {
  const statements: string[] = [];

  // NOTE: schema_version relation is created by MigrationRunner.ensureVersionTable(),
  // not here. This avoids conflicts during migration.

  // Generate node relations (excluding V13+ tables which have dedicated migrations)
  for (const [nodeName, properties] of Object.entries(SCHEMA.nodes)) {
    if (nodeName === "_SchemaVersion") continue;
    if (V13_PLUS_TABLES.has(nodeName)) continue; // Skip V13+ tables
    statements.push(
      generateNodeRelation(nodeName, properties as Record<string, PropertyDefinition>)
    );
  }

  // Generate relationship relations (excluding V13+ relationships)
  for (const [relName, relDef] of Object.entries(SCHEMA.relationships)) {
    if (V13_PLUS_RELATIONSHIPS.has(relName)) continue; // Skip V13+ relationships
    const { from, to, properties } = relDef as {
      from: readonly string[];
      to: readonly string[];
      properties: Record<string, PropertyDefinition>;
    };
    statements.push(generateRelationshipRelation(relName, from, to, properties));
  }

  return statements;
}

/**
 * @deprecated Use generateCozoScript instead
 */
export function generateCypherDDL(): string[] {
  return generateCozoScript();
}

// =============================================================================
// TypeScript Type Generation
// =============================================================================

/**
 * Generates a TypeScript interface for a node type
 */
function generateNodeInterface(
  nodeName: string,
  properties: Record<string, PropertyDefinition>
): string {
  const lines: string[] = [];
  lines.push(`export interface ${nodeName}Node {`);

  for (const [propName, propDef] of Object.entries(properties)) {
    const tsType = TS_TYPE_MAP[propDef.type];
    const optional = propDef.nullable ? "?" : "";
    lines.push(`  ${propName}${optional}: ${tsType};`);
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Generates a TypeScript interface for relationship properties
 */
function generateRelInterface(
  relName: string,
  properties: Record<string, PropertyDefinition>
): string {
  const lines: string[] = [];
  lines.push(`export interface ${relName}Rel {`);

  // Always include from_id and to_id
  lines.push("  from_id: string;");
  lines.push("  to_id: string;");

  for (const [propName, propDef] of Object.entries(properties)) {
    const tsType = TS_TYPE_MAP[propDef.type];
    const optional = propDef.nullable ? "?" : "";
    lines.push(`  ${propName}${optional}: ${tsType};`);
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Generates TypeScript interfaces for all schema types
 *
 * @returns TypeScript source code with all interfaces
 */
export function generateTypeScriptTypes(): string {
  const lines: string[] = [];

  // Add header
  lines.push("/**");
  lines.push(" * Auto-generated TypeScript types from schema definitions");
  lines.push(` * Schema Version: ${SCHEMA_VERSION}`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(" *");
  lines.push(" * DO NOT EDIT - This file is auto-generated");
  lines.push(" * Edit schema-definitions.ts instead");
  lines.push(" */");
  lines.push("");

  // Generate node interfaces
  lines.push("// =============================================================================");
  lines.push("// Node Types");
  lines.push("// =============================================================================");
  lines.push("");

  for (const [nodeName, properties] of Object.entries(SCHEMA.nodes)) {
    lines.push(
      generateNodeInterface(nodeName, properties as Record<string, PropertyDefinition>)
    );
    lines.push("");
  }

  // Generate relationship interfaces
  lines.push("// =============================================================================");
  lines.push("// Relationship Types");
  lines.push("// =============================================================================");
  lines.push("");

  for (const [relName, relDef] of Object.entries(SCHEMA.relationships)) {
    const { properties } = relDef as { properties: Record<string, PropertyDefinition> };
    lines.push(generateRelInterface(relName, properties));
    lines.push("");
  }

  // Generate union types
  lines.push("// =============================================================================");
  lines.push("// Union Types");
  lines.push("// =============================================================================");
  lines.push("");

  const nodeNames = Object.keys(SCHEMA.nodes);
  lines.push(`export type NodeType = ${nodeNames.map((n) => `"${n}"`).join(" | ")};`);
  lines.push("");

  const relNames = Object.keys(SCHEMA.relationships);
  lines.push(`export type RelationshipType = ${relNames.map((r) => `"${r}"`).join(" | ")};`);
  lines.push("");

  // Generate node union
  lines.push("export type AnyNode =");
  for (let i = 0; i < nodeNames.length; i++) {
    const name = nodeNames[i];
    const prefix = i === 0 ? "  | " : "  | ";
    const suffix = i === nodeNames.length - 1 ? ";" : "";
    lines.push(`${prefix}${name}Node${suffix}`);
  }
  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// Schema Validation
// =============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates the schema for consistency and correctness
 *
 * @returns Validation result with any errors or warnings
 */
export function validateSchema(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeNames = new Set(Object.keys(SCHEMA.nodes));

  // Validate nodes
  for (const [nodeName, properties] of Object.entries(SCHEMA.nodes)) {
    const props = properties as Record<string, PropertyDefinition>;

    // Check for primary key
    const hasPrimary = Object.values(props).some((p) => p.primary);
    if (!hasPrimary) {
      // Check if 'id' exists as implicit primary
      if (!("id" in props)) {
        errors.push(`Node "${nodeName}" has no primary key defined`);
      }
    }

    // Check for multiple primary keys (CozoDB supports composite keys, so this is just a warning)
    const primaryCount = Object.values(props).filter((p) => p.primary).length;
    if (primaryCount > 1) {
      warnings.push(`Node "${nodeName}" has multiple primary keys (composite key)`);
    }
  }

  // Validate relationships
  for (const [relName, relDef] of Object.entries(SCHEMA.relationships)) {
    const { from, to } = relDef as { from: readonly string[]; to: readonly string[] };

    // Check that source nodes exist
    for (const nodeName of from) {
      if (!nodeNames.has(nodeName)) {
        errors.push(`Relationship "${relName}" references unknown source node "${nodeName}"`);
      }
    }

    // Check that target nodes exist
    for (const nodeName of to) {
      if (!nodeNames.has(nodeName)) {
        errors.push(`Relationship "${relName}" references unknown target node "${nodeName}"`);
      }
    }
  }

  // Check for reserved names in CozoDB
  const reservedNames = ["_", "?"];
  for (const nodeName of nodeNames) {
    if (reservedNames.some((r) => nodeName.startsWith(r) && nodeName !== "_SchemaVersion")) {
      warnings.push(`Node name "${nodeName}" starts with a reserved character`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Gets the primary key property name for a node type
 */
export function getPrimaryKey(nodeName: NodeName): string {
  const properties = SCHEMA.nodes[nodeName] as Record<string, PropertyDefinition>;

  for (const [propName, propDef] of Object.entries(properties)) {
    if (propDef.primary) {
      return propName;
    }
  }

  // Default to 'id' if no explicit primary key
  return "id";
}

/**
 * Gets the TypeScript type for a schema property
 */
export function getTypeScriptType(propType: PropertyType, nullable: boolean): string {
  const baseType = TS_TYPE_MAP[propType];
  return nullable ? `${baseType} | null` : baseType;
}

/**
 * Gets the CozoDB type for a schema property
 */
export function getCozoType(propType: PropertyType): string {
  return COZO_TYPE_MAP[propType];
}

/**
 * @deprecated Use getCozoType instead
 */
export function getKuzuType(propType: PropertyType): string {
  return getCozoType(propType);
}

/**
 * Gets the CozoDB relation name for a node type (snake_case)
 */
export function getRelationName(nodeName: string): string {
  return pascalToSnakeCase(nodeName);
}

/**
 * Checks if a node type exists in the schema
 */
export function isValidNodeType(name: string): name is NodeName {
  return name in SCHEMA.nodes;
}

/**
 * Checks if a relationship type exists in the schema
 */
export function isValidRelationshipType(name: string): name is RelationshipName {
  return name in SCHEMA.relationships;
}

/**
 * Gets the schema version
 */
export function getSchemaVersion(): number {
  return SCHEMA_VERSION;
}
