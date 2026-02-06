/**
 * Semantic Similarity Service
 *
 * Provides semantic similarity search for code entities.
 * Part of Phase 6: Semantic Similarity & Related Code Discovery.
 *
 * Uses vector embeddings to find functionally similar code across the codebase.
 *
 * @module
 */

import type { IGraphStore } from "../interfaces/IGraphStore.js";
import type { IEmbeddingService } from "./index.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("similarity-service");

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a similarity search.
 */
export interface SimilarEntity {
  /** Entity ID */
  entityId: string;
  /** Entity type */
  entityType: "function" | "class" | "interface" | "method";
  /** Entity name */
  name: string;
  /** File path */
  filePath: string;
  /** Similarity score (0-1, higher is more similar) */
  similarity: number;
  /** Distance from query (lower is more similar) */
  distance: number;
  /** Code signature if available */
  signature?: string;
  /** Brief description if available */
  description?: string;
}

/**
 * Options for similarity search.
 */
export interface SimilaritySearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;
  /** Filter by entity type */
  entityTypes?: Array<"function" | "class" | "interface" | "method">;
  /** Filter by file path pattern */
  filePathPattern?: string;
  /** Exclude specific entity IDs */
  excludeIds?: string[];
}

/**
 * Options for code cluster detection.
 */
export interface ClusterOptions {
  /** Similarity threshold for clustering */
  threshold?: number;
  /** Minimum cluster size */
  minClusterSize?: number;
  /** Maximum number of clusters */
  maxClusters?: number;
}

/**
 * A cluster of semantically related code.
 */
export interface CodeCluster {
  /** Cluster ID */
  id: string;
  /** Representative entity (centroid) */
  centroid: SimilarEntity;
  /** All entities in the cluster */
  members: SimilarEntity[];
  /** Common theme/purpose inferred from members */
  theme?: string;
  /** Average internal similarity */
  cohesion: number;
}

/**
 * Interface for the similarity service.
 */
export interface ISimilarityService {
  initialize(): Promise<void>;
  findSimilarByEntityId(entityId: string, options?: SimilaritySearchOptions): Promise<SimilarEntity[]>;
  findSimilarByText(text: string, options?: SimilaritySearchOptions): Promise<SimilarEntity[]>;
  findSimilarByEmbedding(embedding: number[], options?: SimilaritySearchOptions): Promise<SimilarEntity[]>;
  computeSimilarity(entityId1: string, entityId2: string): Promise<number>;
  clusterSimilarCode(options?: ClusterOptions): Promise<CodeCluster[]>;
  isInitialized(): boolean;
}

// =============================================================================
// Implementation
// =============================================================================

const DEFAULT_SEARCH_OPTIONS: Required<SimilaritySearchOptions> = {
  limit: 10,
  minSimilarity: 0.5,
  entityTypes: ["function", "class", "interface", "method"],
  filePathPattern: "",
  excludeIds: [],
};

const DEFAULT_CLUSTER_OPTIONS: Required<ClusterOptions> = {
  threshold: 0.7,
  minClusterSize: 2,
  maxClusters: 50,
};

/**
 * Semantic Similarity Service.
 *
 * Provides methods to find semantically similar code entities
 * using vector embeddings stored in the graph database.
 *
 * @example
 * ```typescript
 * const service = createSimilarityService(graphStore, embeddingService);
 * await service.initialize();
 *
 * // Find similar functions
 * const similar = await service.findSimilarByEntityId("fn-abc123", { limit: 5 });
 *
 * // Search by natural language
 * const results = await service.findSimilarByText("validate user email address");
 * ```
 */
export class SimilarityService implements ISimilarityService {
  private initialized = false;

  constructor(
    private store: IGraphStore,
    private embeddingService: IEmbeddingService
  ) {}

  /**
   * Initialize the similarity service.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure embedding service is initialized
    if (!this.embeddingService.isInitialized()) {
      await this.embeddingService.initialize();
    }

    this.initialized = true;
    logger.info("Similarity service initialized");
  }

  /**
   * Find entities similar to a given entity by its ID.
   *
   * @param entityId - The entity ID to find similar entities for
   * @param options - Search options
   * @returns Array of similar entities sorted by similarity
   */
  async findSimilarByEntityId(
    entityId: string,
    options?: SimilaritySearchOptions
  ): Promise<SimilarEntity[]> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    // Get the entity's embedding
    const embedding = await this.getEntityEmbedding(entityId);
    if (!embedding) {
      logger.warn({ entityId }, "No embedding found for entity");
      return [];
    }

    // Exclude the source entity from results
    const excludeIds = [...opts.excludeIds, entityId];

    return this.findSimilarByEmbedding(embedding, { ...opts, excludeIds });
  }

  /**
   * Find entities similar to a natural language description.
   *
   * @param text - Natural language description of what to find
   * @param options - Search options
   * @returns Array of similar entities sorted by similarity
   */
  async findSimilarByText(
    text: string,
    options?: SimilaritySearchOptions
  ): Promise<SimilarEntity[]> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    // Generate embedding for the search text
    const result = await this.embeddingService.embed(text);

    return this.findSimilarByEmbedding(result.vector, opts);
  }

  /**
   * Find entities similar to a given embedding vector.
   *
   * @param embedding - The embedding vector to search with
   * @param options - Search options
   * @returns Array of similar entities sorted by similarity
   */
  async findSimilarByEmbedding(
    embedding: number[],
    options?: SimilaritySearchOptions
  ): Promise<SimilarEntity[]> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    try {
      // Prefer store.vectorSearch() which uses entity_embedding when populated (Hybrid Search Phase 1)
      const vectorResults = await this.store.vectorSearch(embedding, opts.limit * 2);
      if (vectorResults.length > 0) {
        const ids = vectorResults.map((r) => r.id);
        const excludeSet = new Set(opts.excludeIds ?? []);
        const idToMeta = await this.getEntityNameAndPath(ids);
        const entities: SimilarEntity[] = [];
        for (const r of vectorResults) {
          if (excludeSet.has(r.id)) continue;
          const similarity = 1 - r.distance;
          if (similarity < opts.minSimilarity) continue;
          const meta = idToMeta.get(r.id);
          entities.push({
            entityId: r.id,
            entityType: (meta?.entityType ?? "function") as SimilarEntity["entityType"],
            name: meta?.name ?? r.id,
            filePath: meta?.filePath ?? "",
            similarity,
            distance: r.distance,
            signature: meta?.signature,
          });
        }
        const filtered = opts.entityTypes.length
          ? entities.filter((e) => opts.entityTypes.includes(e.entityType))
          : entities;
        const byPath = opts.filePathPattern
          ? filtered.filter((e) => new RegExp(opts.filePathPattern!).test(e.filePath))
          : filtered;
        return byPath.slice(0, opts.limit);
      }

      // Fallback: query function_embedding directly (backward compatibility)
      const embeddingStr = `[${embedding.join(", ")}]`;
      const excludeClause =
        opts.excludeIds.length > 0
          ? `not (id in [${opts.excludeIds.map((id) => `"${id}"`).join(", ")}]),`
          : "";

      const query = `
        ?[id, name, file_path, signature, distance] :=
          ~function_embedding:embedding_hnsw{function_id: id | query: ${embeddingStr}, k: ${opts.limit * 2}, ef: 100, bind_distance: distance},
          *function{id, name, file_id, signature},
          *file{id: file_id, path: file_path},
          ${excludeClause}
          distance < ${1 - opts.minSimilarity}
        :order distance
        :limit ${opts.limit}
      `;

      const result = await this.store.query(query);
      const entities: SimilarEntity[] = result.rows.map((row) => {
        const [id, name, filePath, signature, distance] = row as unknown as [
          string,
          string,
          string,
          string | null,
          number
        ];
        return {
          entityId: id,
          entityType: "function" as const,
          name,
          filePath,
          similarity: 1 - distance,
          distance,
          signature: signature ?? undefined,
        };
      });

      const filteredEntities = opts.entityTypes.length
        ? entities.filter((e) => opts.entityTypes.includes(e.entityType))
        : entities;
      if (opts.filePathPattern) {
        const pattern = new RegExp(opts.filePathPattern);
        return filteredEntities.filter((e) => pattern.test(e.filePath));
      }
      return filteredEntities;
    } catch (error) {
      logger.error({ error }, "Vector similarity search failed");
      return [];
    }
  }

  /**
   * Resolve entity IDs to name, file path, and optional signature (for functions).
   * Used to enrich vectorSearch results from entity_embedding.
   */
  private async getEntityNameAndPath(
    ids: string[]
  ): Promise<Map<string, { name: string; filePath: string; entityType: string; signature?: string }>> {
    const map = new Map<string, { name: string; filePath: string; entityType: string; signature?: string }>();
    if (ids.length === 0) return map;

    const run = async (
      type: string,
      script: string,
      params: { ids: string[] },
      hasSignature: boolean
    ): Promise<void> => {
      try {
        const result = await this.store.query(script, params);
        for (const row of result.rows) {
          const r = row as unknown as [string, string, string] | [string, string, string, string];
          const id = r[0];
          const name = r[1];
          const filePath = r[2];
          const signature = hasSignature && r.length > 3 ? (r as [string, string, string, string])[3] : undefined;
          if (!map.has(id)) map.set(id, { name, filePath, entityType: type, signature });
        }
      } catch {
        // Relation may not exist
      }
    };

    await Promise.all([
      run("function", `?[id, name, file_path, signature] := *function{id, name, file_id, signature}, *file{id: file_id, path: file_path}, id in $ids`, { ids }, true),
      run("class", `?[id, name, file_path] := *class{id, name, file_id}, *file{id: file_id, path: file_path}, id in $ids`, { ids }, false),
      run("interface", `?[id, name, file_path] := *interface{id, name, file_id}, *file{id: file_id, path: file_path}, id in $ids`, { ids }, false),
      run("interface", `?[id, name, file_path] := *type_alias{id, name, file_id}, *file{id: file_id, path: file_path}, id in $ids`, { ids }, false),
      run("variable", `?[id, name, file_path] := *variable{id, name, file_id}, *file{id: file_id, path: file_path}, id in $ids`, { ids }, false),
    ]);
    return map;
  }

  /**
   * Compute similarity between two entities.
   *
   * @param entityId1 - First entity ID
   * @param entityId2 - Second entity ID
   * @returns Similarity score (0-1)
   */
  async computeSimilarity(entityId1: string, entityId2: string): Promise<number> {
    const [emb1, emb2] = await Promise.all([
      this.getEntityEmbedding(entityId1),
      this.getEntityEmbedding(entityId2),
    ]);

    if (!emb1 || !emb2) {
      return 0;
    }

    return this.cosineSimilarity(emb1, emb2);
  }

  /**
   * Cluster semantically similar code into groups.
   *
   * Uses a simple greedy clustering algorithm based on similarity threshold.
   *
   * @param options - Clustering options
   * @returns Array of code clusters
   */
  async clusterSimilarCode(options?: ClusterOptions): Promise<CodeCluster[]> {
    const opts = { ...DEFAULT_CLUSTER_OPTIONS, ...options };

    try {
      // Get all entities with embeddings
      const query = `
        ?[id, name, file_path, embedding] :=
          *function_embedding{function_id: id, embedding},
          *function{id, name, file_id},
          *file{id: file_id, path: file_path}
        :limit 1000
      `;

      const result = await this.store.query(query);

      if (result.rows.length === 0) {
        return [];
      }

      // Convert rows to entities with embeddings
      const entities = result.rows.map((row) => {
        const [id, name, filePath, embedding] = row as unknown as [
          string,
          string,
          string,
          number[]
        ];
        return {
          id,
          name,
          filePath,
          embedding,
        };
      });

      // Simple greedy clustering
      const clusters: CodeCluster[] = [];
      const assigned = new Set<string>();

      for (const entity of entities) {
        if (assigned.has(entity.id) || clusters.length >= opts.maxClusters) {
          continue;
        }

        // Start a new cluster with this entity as centroid
        const cluster: CodeCluster = {
          id: `cluster-${clusters.length + 1}`,
          centroid: {
            entityId: entity.id,
            entityType: "function",
            name: entity.name,
            filePath: entity.filePath,
            similarity: 1,
            distance: 0,
          },
          members: [],
          cohesion: 0,
        };

        assigned.add(entity.id);

        // Find similar entities to add to cluster
        for (const candidate of entities) {
          if (assigned.has(candidate.id)) {
            continue;
          }

          const similarity = this.cosineSimilarity(entity.embedding, candidate.embedding);
          if (similarity >= opts.threshold) {
            cluster.members.push({
              entityId: candidate.id,
              entityType: "function",
              name: candidate.name,
              filePath: candidate.filePath,
              similarity,
              distance: 1 - similarity,
            });
            assigned.add(candidate.id);
          }
        }

        // Only keep clusters that meet minimum size
        if (cluster.members.length + 1 >= opts.minClusterSize) {
          // Calculate cohesion (average internal similarity)
          const similarities = cluster.members.map((m) => m.similarity);
          cluster.cohesion =
            similarities.reduce((a, b) => a + b, 0) / similarities.length;

          clusters.push(cluster);
        }
      }

      return clusters;
    } catch (error) {
      logger.error({ error }, "Clustering failed");
      return [];
    }
  }

  /**
   * Check if the service is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Get the embedding for an entity from the database.
   */
  private async getEntityEmbedding(entityId: string): Promise<number[] | null> {
    try {
      const query = `
        ?[embedding] :=
          *function_embedding{function_id: $entityId, embedding}
      `;

      const result = await this.store.query(query, { entityId });

      if (result.rows.length === 0) {
        return null;
      }

      return (result.rows[0] as unknown as { embedding: number[] }).embedding;
    } catch (error) {
      logger.debug({ error, entityId }, "Failed to get entity embedding");
      return null;
    }
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i]!;
      const bVal = b[i]!;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }
}

/**
 * Create a similarity service instance.
 */
export function createSimilarityService(
  store: IGraphStore,
  embeddingService: IEmbeddingService
): SimilarityService {
  return new SimilarityService(store, embeddingService);
}
