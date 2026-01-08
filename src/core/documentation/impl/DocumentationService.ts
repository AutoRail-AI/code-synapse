/**
 * Documentation Service Implementation
 *
 * Links infrastructure code to official documentation, SDK references,
 * and version-specific resources.
 */

import type { IDocumentationService, IDocumentationStorage } from "../interfaces/IDocumentation.js";
import type {
  DocumentationReference,
  EntityDocumentationLink,
  EntityDocumentation,
  DocumentationStats,
  DocumentationType,
} from "../models/documentation-models.js";
import { KNOWN_DOCUMENTATION } from "../models/documentation-models.js";
import { createLogger } from "../../telemetry/logger.js";
import * as crypto from "node:crypto";

const logger = createLogger("documentation-service");

// =============================================================================
// DocumentationService Implementation
// =============================================================================

export class DocumentationService implements IDocumentationService {
  private storage: IDocumentationStorage;
  private graphStore: {
    run: (query: string) => Promise<{ rows: unknown[][] }>;
  };
  private initialized = false;

  constructor(
    storage: IDocumentationStorage,
    graphStore: { run: (query: string) => Promise<{ rows: unknown[][] }> }
  ) {
    this.storage = storage;
    this.graphStore = graphStore;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.debug("Initializing documentation service");

    // Initialize known documentation from registry
    await this.initializeKnownDocumentation();

    this.initialized = true;
    logger.info("Documentation service initialized");
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    logger.info("Documentation service shutdown");
  }

  // ---------------------------------------------------------------------------
  // Auto-Discovery
  // ---------------------------------------------------------------------------

  async discoverDocumentation(entityId: string): Promise<EntityDocumentation> {
    // Get entity details from graph
    const entityQuery = `
      ?[id, name, type, file_path] :=
        (
          (*function{id, name, file_id}, type = "function") or
          (*class{id, name, file_id}, type = "class") or
          (*interface{id, name, file_id}, type = "interface")
        ),
        id = "${entityId}",
        *file{id: file_id, path: file_path}
    `;
    const entityResult = await this.graphStore.run(entityQuery);

    if (entityResult.rows.length === 0) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    const [, entityName, entityType, filePath] = entityResult.rows[0] as [
      string,
      string,
      string,
      string,
    ];

    // Get imports for the file
    const importsQuery = `
      ?[import_path] :=
        *file{id: file_id, path: "${this.escape(filePath)}"},
        *imports{from_id: file_id, import_path}
    `;
    const importsResult = await this.graphStore.run(importsQuery);

    // Extract package names from imports
    const dependencies: EntityDocumentation["dependencies"] = [];
    const packageNames = new Set<string>();

    for (const row of importsResult.rows) {
      const importPath = row[0] as string;
      const packageName = this.extractPackageName(importPath);
      if (packageName && !packageNames.has(packageName)) {
        packageNames.add(packageName);
        dependencies.push({
          packageName,
          usageType: "import",
        });
      }
    }

    // Get documentation for detected packages
    const documentation: EntityDocumentation["documentation"] = [];

    for (const packageName of packageNames) {
      const refs = await this.getPackageDocumentation(packageName);
      for (const ref of refs) {
        // Create link if it doesn't exist
        const linkId = this.generateId(`link-${entityId}-${ref.id}`);
        const existingLinks = await this.storage.getLinksForEntity(entityId);
        const linkExists = existingLinks.some((l) => l.documentationId === ref.id);

        if (!linkExists) {
          const link: EntityDocumentationLink = {
            id: linkId,
            entityId,
            entityType: entityType as EntityDocumentationLink["entityType"],
            documentationId: ref.id,
            relevance: 0.8,
            linkReason: "import-detected",
            createdAt: new Date().toISOString(),
          };
          await this.storage.createLink(link);
        }

        documentation.push({
          ...ref,
          relevance: 0.8,
          linkReason: "import-detected",
        });
      }
    }

    return {
      entityId,
      entityName,
      entityType,
      filePath,
      dependencies,
      documentation,
    };
  }

  async discoverDocumentationForFile(filePath: string): Promise<EntityDocumentation[]> {
    // Get all entities in the file
    const entitiesQuery = `
      ?[id, name, type] :=
        *file{id: file_id, path: "${this.escape(filePath)}"},
        (
          (*contains{from_id: file_id, to_id: id, to_type: "function"}, *function{id, name}, type = "function") or
          (*contains{from_id: file_id, to_id: id, to_type: "class"}, *class{id, name}, type = "class") or
          (*contains{from_id: file_id, to_id: id, to_type: "interface"}, *interface{id, name}, type = "interface")
        )
    `;
    const entitiesResult = await this.graphStore.run(entitiesQuery);

    const results: EntityDocumentation[] = [];
    for (const row of entitiesResult.rows) {
      const entityId = row[0] as string;
      try {
        const doc = await this.discoverDocumentation(entityId);
        results.push(doc);
      } catch (error) {
        logger.warn({ entityId, error }, "Failed to discover documentation for entity");
      }
    }

    return results;
  }

  async discoverAllDocumentation(): Promise<{
    entitiesProcessed: number;
    linksCreated: number;
    referencesCreated: number;
  }> {
    logger.info("Starting full documentation discovery");

    let entitiesProcessed = 0;
    let linksCreated = 0;
    const referencesCreated = 0;

    // Get all files
    const filesQuery = `?[path] := *file{path}`;
    const filesResult = await this.graphStore.run(filesQuery);

    for (const row of filesResult.rows) {
      const filePath = row[0] as string;
      try {
        const docs = await this.discoverDocumentationForFile(filePath);
        entitiesProcessed += docs.length;
        linksCreated += docs.reduce((sum, d) => sum + d.documentation.length, 0);
      } catch (error) {
        logger.warn({ filePath, error }, "Failed to discover documentation for file");
      }
    }

    logger.info({ entitiesProcessed, linksCreated, referencesCreated }, "Documentation discovery complete");

    return { entitiesProcessed, linksCreated, referencesCreated };
  }

  // ---------------------------------------------------------------------------
  // Package Documentation
  // ---------------------------------------------------------------------------

  async getPackageDocumentation(packageName: string, _version?: string): Promise<DocumentationReference[]> {
    // Check storage first
    const existing = await this.storage.getReferencesByPackage(packageName);
    if (existing.length > 0) {
      return existing;
    }

    // Check known documentation registry
    const normalizedName = packageName.toLowerCase();
    const knownDocs = KNOWN_DOCUMENTATION[normalizedName] ?? KNOWN_DOCUMENTATION[packageName];

    if (knownDocs) {
      const references: DocumentationReference[] = knownDocs.map((doc) => ({
        id: this.generateId(`${packageName}-${doc.type}`),
        packageName,
        type: doc.type,
        url: doc.url,
        title: doc.title,
        source: "official" as const,
        confidence: 1.0,
        createdAt: new Date().toISOString(),
      }));

      // Store for future use
      await this.storage.storeReferences(references);
      return references;
    }

    // Try to fetch from npm
    try {
      const npmRefs = await this.fetchFromNpm(packageName);
      if (npmRefs.length > 0) {
        await this.storage.storeReferences(npmRefs);
        return npmRefs;
      }
    } catch (error) {
      logger.debug({ packageName, error }, "Failed to fetch from npm");
    }

    return [];
  }

  async fetchFromNpm(packageName: string): Promise<DocumentationReference[]> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        homepage?: string;
        repository?: { url?: string } | string;
        bugs?: { url?: string };
        readme?: string;
      };

      const references: DocumentationReference[] = [];
      const now = new Date().toISOString();

      // Homepage
      if (data.homepage) {
        references.push({
          id: this.generateId(`${packageName}-homepage`),
          packageName,
          type: "official-docs",
          url: data.homepage,
          title: `${packageName} Homepage`,
          source: "npm",
          confidence: 0.9,
          createdAt: now,
        });
      }

      // Repository
      const repoUrl =
        typeof data.repository === "string"
          ? data.repository
          : data.repository?.url;
      if (repoUrl) {
        const cleanRepoUrl = repoUrl
          .replace(/^git\+/, "")
          .replace(/\.git$/, "")
          .replace(/^git:\/\//, "https://");
        references.push({
          id: this.generateId(`${packageName}-repo`),
          packageName,
          type: "github-repo",
          url: cleanRepoUrl,
          title: `${packageName} Repository`,
          source: "npm",
          confidence: 0.95,
          createdAt: now,
        });
      }

      // NPM package page
      references.push({
        id: this.generateId(`${packageName}-npm`),
        packageName,
        type: "npm-package",
        url: `https://www.npmjs.com/package/${packageName}`,
        title: `${packageName} on npm`,
        source: "npm",
        confidence: 1.0,
        createdAt: now,
      });

      return references;
    } catch (error) {
      logger.debug({ packageName, error }, "Failed to fetch npm metadata");
      return [];
    }
  }

  async registerDocumentation(
    packageName: string,
    type: DocumentationType,
    url: string,
    title: string,
    description?: string
  ): Promise<DocumentationReference> {
    const reference: DocumentationReference = {
      id: this.generateId(`${packageName}-${type}-manual`),
      packageName,
      type,
      url,
      title,
      description,
      source: "internal",
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    };

    await this.storage.storeReference(reference);
    return reference;
  }

  // ---------------------------------------------------------------------------
  // Entity Queries
  // ---------------------------------------------------------------------------

  async getDocumentationForEntity(entityId: string): Promise<EntityDocumentation> {
    // Get entity details
    const entityQuery = `
      ?[id, name, type, file_path] :=
        (
          (*function{id, name, file_id}, type = "function") or
          (*class{id, name, file_id}, type = "class") or
          (*interface{id, name, file_id}, type = "interface")
        ),
        id = "${entityId}",
        *file{id: file_id, path: file_path}
    `;
    const entityResult = await this.graphStore.run(entityQuery);

    if (entityResult.rows.length === 0) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    const [, entityName, entityType, filePath] = entityResult.rows[0] as [
      string,
      string,
      string,
      string,
    ];

    // Get existing links
    const links = await this.storage.getLinksForEntity(entityId);

    // Get documentation references for each link
    const documentation: EntityDocumentation["documentation"] = [];
    for (const link of links) {
      const ref = await this.storage.getReference(link.documentationId);
      if (ref) {
        documentation.push({
          ...ref,
          relevance: link.relevance,
          linkReason: link.linkReason,
        });
      }
    }

    // Extract dependencies from documentation
    const dependencies: EntityDocumentation["dependencies"] = [];
    const seenPackages = new Set<string>();
    for (const doc of documentation) {
      if (!seenPackages.has(doc.packageName)) {
        seenPackages.add(doc.packageName);
        dependencies.push({
          packageName: doc.packageName,
          version: doc.version,
          usageType: "import",
        });
      }
    }

    return {
      entityId,
      entityName,
      entityType,
      filePath,
      dependencies,
      documentation,
    };
  }

  async getEntitiesUsingPackage(packageName: string): Promise<
    Array<{
      entityId: string;
      entityName: string;
      entityType: string;
      filePath: string;
      usageType: "import" | "type" | "api-call";
    }>
  > {
    // Get documentation references for this package
    const refs = await this.storage.getReferencesByPackage(packageName);
    if (refs.length === 0) return [];

    const results: Array<{
      entityId: string;
      entityName: string;
      entityType: string;
      filePath: string;
      usageType: "import" | "type" | "api-call";
    }> = [];

    // Get links for each reference
    for (const ref of refs) {
      const links = await this.storage.getLinksForDocumentation(ref.id);
      for (const link of links) {
        // Get entity details
        const entityQuery = `
          ?[name, file_path] :=
            (
              (*function{id: "${link.entityId}", name, file_id}) or
              (*class{id: "${link.entityId}", name, file_id}) or
              (*interface{id: "${link.entityId}", name, file_id})
            ),
            *file{id: file_id, path: file_path}
        `;
        const entityResult = await this.graphStore.run(entityQuery);

        if (entityResult.rows.length > 0) {
          const [entityName, filePath] = entityResult.rows[0] as [string, string];
          results.push({
            entityId: link.entityId,
            entityName,
            entityType: link.entityType,
            filePath,
            usageType: link.linkReason === "import-detected" ? "import" : "api-call",
          });
        }
      }
    }

    return results;
  }

  async getEntitiesWithoutDocumentation(
    limit = 100
  ): Promise<Array<{ entityId: string; entityName: string; entityType: string; filePath: string }>> {
    // Get all entities
    const entitiesQuery = `
      ?[id, name, type, file_path] :=
        (
          (*function{id, name, file_id}, type = "function") or
          (*class{id, name, file_id}, type = "class")
        ),
        *file{id: file_id, path: file_path}
      :limit ${limit * 2}
    `;
    const entitiesResult = await this.graphStore.run(entitiesQuery);

    const results: Array<{
      entityId: string;
      entityName: string;
      entityType: string;
      filePath: string;
    }> = [];

    for (const row of entitiesResult.rows) {
      if (results.length >= limit) break;

      const [entityId, entityName, entityType, filePath] = row as [string, string, string, string];
      const links = await this.storage.getLinksForEntity(entityId);

      if (links.length === 0) {
        results.push({ entityId, entityName, entityType, filePath });
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  async getStats(): Promise<DocumentationStats> {
    return this.storage.getStats();
  }

  async getFileDocumentationCoverage(filePath: string): Promise<{
    totalEntities: number;
    entitiesWithDocs: number;
    coveragePercent: number;
    packages: string[];
  }> {
    // Get entities in file
    const entitiesQuery = `
      ?[id] :=
        *file{id: file_id, path: "${this.escape(filePath)}"},
        *contains{from_id: file_id, to_id: id}
    `;
    const entitiesResult = await this.graphStore.run(entitiesQuery);
    const totalEntities = entitiesResult.rows.length;

    let entitiesWithDocs = 0;
    const packages = new Set<string>();

    for (const row of entitiesResult.rows) {
      const entityId = row[0] as string;
      const links = await this.storage.getLinksForEntity(entityId);

      if (links.length > 0) {
        entitiesWithDocs++;
        for (const link of links) {
          const ref = await this.storage.getReference(link.documentationId);
          if (ref) {
            packages.add(ref.packageName);
          }
        }
      }
    }

    return {
      totalEntities,
      entitiesWithDocs,
      coveragePercent: totalEntities > 0 ? (entitiesWithDocs / totalEntities) * 100 : 0,
      packages: Array.from(packages),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async initializeKnownDocumentation(): Promise<void> {
    logger.debug("Initializing known documentation from registry");

    for (const [packageName, docs] of Object.entries(KNOWN_DOCUMENTATION)) {
      const existing = await this.storage.getReferencesByPackage(packageName);
      if (existing.length === 0) {
        const references: DocumentationReference[] = docs.map((doc) => ({
          id: this.generateId(`${packageName}-${doc.type}`),
          packageName,
          type: doc.type,
          url: doc.url,
          title: doc.title,
          source: "official" as const,
          confidence: 1.0,
          createdAt: new Date().toISOString(),
        }));

        try {
          await this.storage.storeReferences(references);
        } catch {
          // Ignore duplicate errors
        }
      }
    }
  }

  private extractPackageName(importPath: string): string | null {
    // Handle scoped packages (@org/package)
    if (importPath.startsWith("@")) {
      const parts = importPath.split("/");
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
    }

    // Handle regular packages
    const parts = importPath.split("/");
    const firstPart = parts[0];

    // Skip relative imports
    if (!firstPart || firstPart.startsWith(".") || firstPart.startsWith("/")) {
      return null;
    }

    // Skip node built-ins
    const nodeBuiltins = new Set([
      "fs",
      "path",
      "http",
      "https",
      "crypto",
      "stream",
      "util",
      "os",
      "events",
      "buffer",
      "url",
      "querystring",
      "zlib",
      "child_process",
      "cluster",
      "dns",
      "net",
      "readline",
      "tls",
      "dgram",
      "assert",
      "v8",
      "vm",
      "worker_threads",
    ]);

    if (nodeBuiltins.has(firstPart) || importPath.startsWith("node:")) {
      return null;
    }

    return firstPart;
  }

  private generateId(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  }

  private escape(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createDocumentationService(
  storage: IDocumentationStorage,
  graphStore: { run: (query: string) => Promise<{ rows: unknown[][] }> }
): DocumentationService {
  return new DocumentationService(storage, graphStore);
}
