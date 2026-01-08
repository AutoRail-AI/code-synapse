/**
 * CozoDB Documentation Storage
 *
 * Stores documentation references and entity-documentation links in CozoDB.
 */

import type { IDocumentationStorage } from "../interfaces/IDocumentation.js";
import type {
  DocumentationReference,
  EntityDocumentationLink,
  DocumentationStats,
  DocumentationType,
} from "../models/documentation-models.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("documentation-storage");

// =============================================================================
// Schema Definitions
// =============================================================================

const SCHEMA_QUERIES = [
  // Documentation references table
  `:create documentation_reference {
    id: String =>
    package_name: String,
    version: String?,
    type: String,
    url: String,
    title: String,
    description: String?,
    source: String,
    confidence: Float,
    last_verified_at: String?,
    created_at: String,
    tags: String?
  }`,

  // Entity-documentation links table
  `:create entity_documentation_link {
    id: String =>
    entity_id: String,
    entity_type: String,
    documentation_id: String,
    relevance: Float,
    link_reason: String,
    created_at: String
  }`,

  // Indices for efficient queries
  `::index create documentation_reference:package_idx { package_name }`,
  `::index create documentation_reference:type_idx { type }`,
  `::index create entity_documentation_link:entity_idx { entity_id }`,
  `::index create entity_documentation_link:doc_idx { documentation_id }`,
];

// =============================================================================
// CozoDocumentationStorage Implementation
// =============================================================================

export class CozoDocumentationStorage implements IDocumentationStorage {
  private db: { run: (query: string) => Promise<{ rows: unknown[][] }> };
  private initialized = false;

  constructor(database: { run: (query: string) => Promise<{ rows: unknown[][] }> }) {
    this.db = database;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.debug("Initializing documentation storage schema");

    for (const query of SCHEMA_QUERIES) {
      try {
        await this.db.run(query);
      } catch (error) {
        // Schema might already exist
        const msg = error instanceof Error ? error.message : String(error);
        if (!msg.includes("already exists")) {
          logger.warn({ query, error: msg }, "Schema creation warning");
        }
      }
    }

    this.initialized = true;
    logger.info("Documentation storage initialized");
  }

  // ---------------------------------------------------------------------------
  // Documentation References
  // ---------------------------------------------------------------------------

  async storeReference(reference: DocumentationReference): Promise<void> {
    const query = `
      ?[id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags] <- [[
        "${reference.id}",
        "${this.escape(reference.packageName)}",
        ${reference.version ? `"${this.escape(reference.version)}"` : "null"},
        "${reference.type}",
        "${this.escape(reference.url)}",
        "${this.escape(reference.title)}",
        ${reference.description ? `"${this.escape(reference.description)}"` : "null"},
        "${reference.source}",
        ${reference.confidence},
        ${reference.lastVerifiedAt ? `"${reference.lastVerifiedAt}"` : "null"},
        "${reference.createdAt}",
        ${reference.tags ? `"${this.escape(reference.tags.join(","))}"` : "null"}
      ]]
      :put documentation_reference {
        id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags
      }
    `;
    await this.db.run(query);
  }

  async storeReferences(references: DocumentationReference[]): Promise<void> {
    if (references.length === 0) return;

    const rows = references
      .map(
        (r) =>
          `["${r.id}", "${this.escape(r.packageName)}", ${r.version ? `"${this.escape(r.version)}"` : "null"}, "${r.type}", "${this.escape(r.url)}", "${this.escape(r.title)}", ${r.description ? `"${this.escape(r.description)}"` : "null"}, "${r.source}", ${r.confidence}, ${r.lastVerifiedAt ? `"${r.lastVerifiedAt}"` : "null"}, "${r.createdAt}", ${r.tags ? `"${this.escape(r.tags.join(","))}"` : "null"}]`
      )
      .join(",\n");

    const query = `
      ?[id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags] <- [
        ${rows}
      ]
      :put documentation_reference {
        id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags
      }
    `;
    await this.db.run(query);
  }

  async getReference(id: string): Promise<DocumentationReference | null> {
    const query = `
      ?[id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags] :=
        *documentation_reference{id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags},
        id = "${id}"
    `;
    const result = await this.db.run(query);

    if (result.rows.length === 0) return null;

    return this.rowToReference(result.rows[0]!);
  }

  async getReferencesByPackage(packageName: string): Promise<DocumentationReference[]> {
    const query = `
      ?[id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags] :=
        *documentation_reference{id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags},
        package_name = "${this.escape(packageName)}"
    `;
    const result = await this.db.run(query);
    return result.rows.map((row) => this.rowToReference(row));
  }

  async getReferencesByType(type: DocumentationType): Promise<DocumentationReference[]> {
    const query = `
      ?[id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags] :=
        *documentation_reference{id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags},
        type = "${type}"
    `;
    const result = await this.db.run(query);
    return result.rows.map((row) => this.rowToReference(row));
  }

  async searchReferences(searchQuery: string, limit = 50): Promise<DocumentationReference[]> {
    const escaped = this.escape(searchQuery.toLowerCase());
    const query = `
      ?[id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags] :=
        *documentation_reference{id, package_name, version, type, url, title, description, source, confidence, last_verified_at, created_at, tags},
        (lowercase(package_name) ~ "${escaped}" or lowercase(title) ~ "${escaped}")
      :limit ${limit}
    `;
    const result = await this.db.run(query);
    return result.rows.map((row) => this.rowToReference(row));
  }

  async deleteReference(id: string): Promise<void> {
    // Delete associated links first
    await this.db.run(`
      ?[id] := *entity_documentation_link{id, documentation_id}, documentation_id = "${id}"
      :rm entity_documentation_link { id }
    `);

    // Delete the reference
    await this.db.run(`
      ?[id] <- [["${id}"]]
      :rm documentation_reference { id }
    `);
  }

  // ---------------------------------------------------------------------------
  // Entity-Documentation Links
  // ---------------------------------------------------------------------------

  async createLink(link: EntityDocumentationLink): Promise<void> {
    const query = `
      ?[id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at] <- [[
        "${link.id}",
        "${link.entityId}",
        "${link.entityType}",
        "${link.documentationId}",
        ${link.relevance},
        "${link.linkReason}",
        "${link.createdAt}"
      ]]
      :put entity_documentation_link {
        id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at
      }
    `;
    await this.db.run(query);
  }

  async createLinks(links: EntityDocumentationLink[]): Promise<void> {
    if (links.length === 0) return;

    const rows = links
      .map(
        (l) =>
          `["${l.id}", "${l.entityId}", "${l.entityType}", "${l.documentationId}", ${l.relevance}, "${l.linkReason}", "${l.createdAt}"]`
      )
      .join(",\n");

    const query = `
      ?[id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at] <- [
        ${rows}
      ]
      :put entity_documentation_link {
        id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at
      }
    `;
    await this.db.run(query);
  }

  async getLinksForEntity(entityId: string): Promise<EntityDocumentationLink[]> {
    const query = `
      ?[id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at] :=
        *entity_documentation_link{id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at},
        entity_id = "${entityId}"
    `;
    const result = await this.db.run(query);
    return result.rows.map((row) => this.rowToLink(row));
  }

  async getLinksForDocumentation(documentationId: string): Promise<EntityDocumentationLink[]> {
    const query = `
      ?[id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at] :=
        *entity_documentation_link{id, entity_id, entity_type, documentation_id, relevance, link_reason, created_at},
        documentation_id = "${documentationId}"
    `;
    const result = await this.db.run(query);
    return result.rows.map((row) => this.rowToLink(row));
  }

  async deleteLink(id: string): Promise<void> {
    await this.db.run(`
      ?[id] <- [["${id}"]]
      :rm entity_documentation_link { id }
    `);
  }

  async deleteLinksForEntity(entityId: string): Promise<void> {
    await this.db.run(`
      ?[id] := *entity_documentation_link{id, entity_id}, entity_id = "${entityId}"
      :rm entity_documentation_link { id }
    `);
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  async getStats(): Promise<DocumentationStats> {
    // Get total references
    const refCountResult = await this.db.run(`
      ?[count(id)] := *documentation_reference{id}
    `);
    const totalReferences = (refCountResult.rows[0]?.[0] as number) ?? 0;

    // Get by type
    const byTypeResult = await this.db.run(`
      ?[type, count(id)] := *documentation_reference{id, type}
    `);
    const byType: Record<string, number> = {};
    for (const row of byTypeResult.rows) {
      byType[row[0] as string] = row[1] as number;
    }

    // Get by source
    const bySourceResult = await this.db.run(`
      ?[source, count(id)] := *documentation_reference{id, source}
    `);
    const bySource: Record<string, number> = {};
    for (const row of bySourceResult.rows) {
      bySource[row[0] as string] = row[1] as number;
    }

    // Get total links
    const linkCountResult = await this.db.run(`
      ?[count(id)] := *entity_documentation_link{id}
    `);
    const totalLinks = (linkCountResult.rows[0]?.[0] as number) ?? 0;

    // Get entities with docs (distinct entity_ids)
    const entitiesWithDocsResult = await this.db.run(`
      ?[count_unique(entity_id)] := *entity_documentation_link{entity_id}
    `);
    const entitiesWithDocs = (entitiesWithDocsResult.rows[0]?.[0] as number) ?? 0;

    // Get total entities (approximation from function count)
    const totalEntitiesResult = await this.db.run(`
      ?[count(id)] := *function{id}
    `);
    const totalEntities = (totalEntitiesResult.rows[0]?.[0] as number) ?? 1;
    const entitiesWithoutDocs = Math.max(0, totalEntities - entitiesWithDocs);

    // Top packages
    const topPackagesResult = await this.db.run(`
      ?[package_name, ref_count, link_count] :=
        *documentation_reference{id: ref_id, package_name},
        ref_count = count(ref_id),
        link_count = count(link_id),
        *entity_documentation_link{id: link_id, documentation_id},
        documentation_id = ref_id
      :order -ref_count
      :limit 10
    `);
    const topPackages = topPackagesResult.rows.map((row) => ({
      packageName: row[0] as string,
      referenceCount: row[1] as number,
      linkCount: row[2] as number,
    }));

    return {
      totalReferences,
      byType: byType as Record<DocumentationType, number>,
      bySource: bySource as Record<string, number>,
      totalLinks,
      entitiesWithDocs,
      entitiesWithoutDocs,
      coveragePercent: totalEntities > 0 ? (entitiesWithDocs / totalEntities) * 100 : 0,
      topPackages,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private escape(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }

  private rowToReference(row: unknown[]): DocumentationReference {
    return {
      id: row[0] as string,
      packageName: row[1] as string,
      version: row[2] as string | undefined,
      type: row[3] as DocumentationType,
      url: row[4] as string,
      title: row[5] as string,
      description: row[6] as string | undefined,
      source: row[7] as DocumentationReference["source"],
      confidence: row[8] as number,
      lastVerifiedAt: row[9] as string | undefined,
      createdAt: row[10] as string,
      tags: row[11] ? (row[11] as string).split(",") : undefined,
    };
  }

  private rowToLink(row: unknown[]): EntityDocumentationLink {
    return {
      id: row[0] as string,
      entityId: row[1] as string,
      entityType: row[2] as EntityDocumentationLink["entityType"],
      documentationId: row[3] as string,
      relevance: row[4] as number,
      linkReason: row[5] as EntityDocumentationLink["linkReason"],
      createdAt: row[6] as string,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createDocumentationStorage(
  database: { run: (query: string) => Promise<{ rows: unknown[][] }> }
): CozoDocumentationStorage {
  return new CozoDocumentationStorage(database);
}
