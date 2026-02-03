/**
 * CozoDB Project Memory Implementation
 *
 * Persistent memory system for storing and retrieving developer rules,
 * conventions, and learned patterns. Uses CozoDB for storage and
 * vector embeddings for semantic search.
 */

import * as path from "node:path";
import type {
  IProjectMemory,
  IMemoryStorage,
  IMemoryLearner,
  IMemoryRetriever,
  ProjectMemoryConfig,
} from "../interfaces/IProjectMemory.js";
import type {
  ProjectMemoryRule,
  MemoryQuery,
  SemanticMemoryQuery,
  MemoryStats,
  MemoryRuleScope,
  MemoryRuleCategory,
  TriggerType,
} from "../models/memory-models.js";
import { createMemoryRule, createMemoryRuleRef } from "../models/memory-models.js";
import { DEFAULT_MEMORY_CONFIG } from "../interfaces/IProjectMemory.js";
import type { IStorageAdapter } from "../../graph/interfaces/IStorageAdapter.js";
import type { IChangeLedger } from "../../ledger/interfaces/IChangeLedger.js";
import { createLedgerEntry } from "../../ledger/models/ledger-events.js";
import type { EmbeddingService } from "../../embeddings/index.js";
import { createLogger } from "../../telemetry/logger.js";

const logger = createLogger("project-memory");

// =============================================================================
// Storage Implementation
// =============================================================================

interface MemoryRuleRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  scope: string;
  scopeTarget: string | null;
  category: string;
  triggerType: string;
  triggerPattern: string;
  triggerDescription: string | null;
  ruleText: string;
  ruleExplanation: string | null;
  examples: string;
  source: string;
  sourceEventId: string | null;
  sourceSessionId: string | null;
  confidence: number;
  validationCount: number;
  violationCount: number;
  lastValidatedAt: string | null;
  lastViolatedAt: string | null;
  embedding: string | null;
  isActive: number;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
}

// Table name constant
const TABLE_NAME = "ProjectMemoryRule";

export class CozoMemoryStorage implements IMemoryStorage {
  private adapter: IStorageAdapter;

  constructor(adapter: IStorageAdapter) {
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    // Schema created by graph database initialization
    logger.info("Memory storage initialized");
  }

  async store(rule: ProjectMemoryRule): Promise<void> {
    const record = this.ruleToRecord(rule);
    await this.adapter.storeOne(TABLE_NAME, record as unknown as Record<string, unknown>);
  }

  async storeBatch(rules: ProjectMemoryRule[]): Promise<void> {
    const records = rules.map((rule) => this.ruleToRecord(rule));
    await this.adapter.store(TABLE_NAME, records as unknown as Record<string, unknown>[]);
  }

  async update(rule: ProjectMemoryRule): Promise<void> {
    await this.store(rule);
  }

  async getById(id: string): Promise<ProjectMemoryRule | null> {
    const record = await this.adapter.findOne<MemoryRuleRow>(TABLE_NAME, [
      { field: "id", operator: "eq", value: id },
    ]);

    if (!record) return null;
    return this.rowToRule(record);
  }

  async query(queryParams: MemoryQuery): Promise<ProjectMemoryRule[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {
      limit: queryParams.limit ?? 100,
      offset: queryParams.offset ?? 0,
    };

    if (queryParams.scope) {
      conditions.push("scope == $scope");
      params.scope = queryParams.scope;
    }
    if (queryParams.scopeTarget) {
      conditions.push("scopeTarget == $scopeTarget");
      params.scopeTarget = queryParams.scopeTarget;
    }
    if (queryParams.category) {
      conditions.push("category == $category");
      params.category = queryParams.category;
    }
    if (queryParams.triggerType) {
      conditions.push("triggerType == $triggerType");
      params.triggerType = queryParams.triggerType;
    }
    if (queryParams.minConfidence !== undefined) {
      conditions.push("confidence >= $minConfidence");
      params.minConfidence = queryParams.minConfidence;
    }
    if (queryParams.isActive !== undefined) {
      conditions.push("isActive == $isActive");
      params.isActive = queryParams.isActive ? 1 : 0;
    }

    const whereClause = conditions.length > 0 ? `, ${conditions.join(", ")}` : "";

    // Use rawQuery for complex ordering
    const dbQuery = `
      ?[id, createdAt, updatedAt, scope, scopeTarget, category,
        triggerType, triggerPattern, triggerDescription, ruleText, ruleExplanation,
        examples, source, sourceEventId, sourceSessionId, confidence,
        validationCount, violationCount, lastValidatedAt, lastViolatedAt,
        embedding, isActive, deprecatedAt, deprecatedReason] :=
        *${TABLE_NAME}{
          id, createdAt, updatedAt, scope, scopeTarget, category,
          triggerType, triggerPattern, triggerDescription, ruleText, ruleExplanation,
          examples, source, sourceEventId, sourceSessionId, confidence,
          validationCount, violationCount, lastValidatedAt, lastViolatedAt,
          embedding, isActive, deprecatedAt, deprecatedReason
        }${whereClause}
      :order -confidence
      :limit $limit
      :offset $offset
    `;

    const rows = await this.adapter.rawQuery<MemoryRuleRow>(dbQuery, params);
    return rows.map((row) => this.rowToRule(row));
  }

  async searchSemantic(
    embedding: number[],
    limit: number,
    _minSimilarity?: number
  ): Promise<ProjectMemoryRule[]> {
    // Get all rules with embeddings and compute similarity
    const all = await this.query({ isActive: true, limit: 1000 });
    const withEmbeddings = all.filter((r) => r.embedding && r.embedding.length > 0);

    // Calculate cosine similarity
    const scored = withEmbeddings.map((rule) => ({
      rule,
      similarity: this.cosineSimilarity(embedding, rule.embedding!),
    }));

    // Sort by similarity and return top results
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit).map((s) => s.rule);
  }

  async getByTrigger(triggerType: TriggerType, pattern: string): Promise<ProjectMemoryRule[]> {
    const all = await this.query({ triggerType, isActive: true, limit: 1000 });

    // Filter by pattern matching
    return all.filter((rule) => {
      try {
        const regex = new RegExp(rule.triggerPattern, "i");
        return regex.test(pattern);
      } catch {
        return rule.triggerPattern === pattern;
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.adapter.delete(TABLE_NAME, id);
  }

  async getStats(): Promise<MemoryStats> {
    const all = await this.query({ limit: 10000 });

    const byScope: Record<MemoryRuleScope, number> = {
      project: 0,
      module: 0,
      vertical: 0,
      horizontal: 0,
      file: 0,
      entity: 0,
    };
    const byCategory: Record<MemoryRuleCategory, number> = {
      convention: 0,
      architecture: 0,
      "anti-pattern": 0,
      preference: 0,
      dependency: 0,
      testing: 0,
      security: 0,
      performance: 0,
    };
    const bySource: Record<string, number> = {};

    let totalConfidence = 0;
    let highConfidenceCount = 0;
    let activeCount = 0;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let recentlyValidated = 0;
    let recentlyViolated = 0;

    for (const rule of all) {
      byScope[rule.scope] = (byScope[rule.scope] ?? 0) + 1;
      byCategory[rule.category] = (byCategory[rule.category] ?? 0) + 1;
      bySource[rule.source] = (bySource[rule.source] ?? 0) + 1;

      totalConfidence += rule.confidence;
      if (rule.confidence > 0.8) highConfidenceCount++;
      if (rule.isActive) activeCount++;
      if (rule.lastValidatedAt && rule.lastValidatedAt > sevenDaysAgo) recentlyValidated++;
      if (rule.lastViolatedAt && rule.lastViolatedAt > sevenDaysAgo) recentlyViolated++;
    }

    return {
      totalRules: all.length,
      activeRules: activeCount,
      byScope,
      byCategory,
      bySource,
      averageConfidence: all.length > 0 ? totalConfidence / all.length : 0,
      highConfidenceRules: highConfidenceCount,
      recentlyValidated,
      recentlyViolated,
    };
  }

  async applyDecay(decayFactor: number, minConfidence: number): Promise<number> {
    const all = await this.query({ isActive: true, limit: 10000 });
    let updated = 0;

    for (const rule of all) {
      const newConfidence = rule.confidence * decayFactor;
      if (newConfidence < minConfidence) {
        // Deprecate rule
        rule.isActive = false;
        rule.deprecatedAt = new Date().toISOString();
        rule.deprecatedReason = "Confidence decayed below minimum";
      } else {
        rule.confidence = newConfidence;
      }
      rule.updatedAt = new Date().toISOString();
      await this.update(rule);
      updated++;
    }

    return updated;
  }

  // ===========================================================================
  // Conversion Helpers
  // ===========================================================================

  private ruleToRecord(rule: ProjectMemoryRule): MemoryRuleRow {
    return {
      id: rule.id,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      scope: rule.scope,
      scopeTarget: rule.scopeTarget ?? null,
      category: rule.category,
      triggerType: rule.triggerType,
      triggerPattern: rule.triggerPattern,
      triggerDescription: rule.triggerDescription ?? null,
      ruleText: rule.ruleText,
      ruleExplanation: rule.ruleExplanation ?? null,
      examples: JSON.stringify(rule.examples),
      source: rule.source,
      sourceEventId: rule.sourceEventId ?? null,
      sourceSessionId: rule.sourceSessionId ?? null,
      confidence: rule.confidence,
      validationCount: rule.validationCount,
      violationCount: rule.violationCount,
      lastValidatedAt: rule.lastValidatedAt ?? null,
      lastViolatedAt: rule.lastViolatedAt ?? null,
      embedding: rule.embedding ? JSON.stringify(rule.embedding) : null,
      isActive: rule.isActive ? 1 : 0,
      deprecatedAt: rule.deprecatedAt ?? null,
      deprecatedReason: rule.deprecatedReason ?? null,
    };
  }

  private rowToRule(row: MemoryRuleRow): ProjectMemoryRule {
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      scope: row.scope as MemoryRuleScope,
      scopeTarget: row.scopeTarget ?? undefined,
      category: row.category as MemoryRuleCategory,
      triggerType: row.triggerType as TriggerType,
      triggerPattern: row.triggerPattern,
      triggerDescription: row.triggerDescription ?? undefined,
      ruleText: row.ruleText,
      ruleExplanation: row.ruleExplanation ?? undefined,
      examples: JSON.parse(row.examples),
      source: row.source as ProjectMemoryRule["source"],
      sourceEventId: row.sourceEventId ?? undefined,
      sourceSessionId: row.sourceSessionId ?? undefined,
      confidence: row.confidence,
      validationCount: row.validationCount,
      violationCount: row.violationCount,
      lastValidatedAt: row.lastValidatedAt ?? undefined,
      lastViolatedAt: row.lastViolatedAt ?? undefined,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      isActive: row.isActive === 1,
      deprecatedAt: row.deprecatedAt ?? undefined,
      deprecatedReason: row.deprecatedReason ?? undefined,
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

// =============================================================================
// Memory Learner Implementation
// =============================================================================

export class SimpleMemoryLearner implements IMemoryLearner {
  private storage: IMemoryStorage;
  private embeddings: EmbeddingService | null;

  constructor(storage: IMemoryStorage, embeddings?: EmbeddingService) {
    this.storage = storage;
    this.embeddings = embeddings ?? null;
  }

  async learnFromCorrection(
    originalCode: string,
    correctedCode: string,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null> {
    // Analyze the diff to understand what was corrected
    const changes = this.analyzeCodeDiff(originalCode, correctedCode);
    if (changes.length === 0) return null;

    // Create a rule based on the first significant change
    const change = changes[0]!;
    const ext = path.extname(filePath);

    const rule = createMemoryRule(
      "file",
      "convention",
      "file-pattern",
      `*${ext}`,
      change.ruleText,
      "user-correction",
      {
        scopeTarget: path.dirname(filePath),
        ruleExplanation: `Learned from correction in ${filePath}`,
        examples: [
          {
            bad: change.original,
            good: change.corrected,
          },
        ],
        confidence: 0.6,
        sourceSessionId: sessionId,
      }
    );

    // Generate embedding if available
    if (this.embeddings) {
      try {
        const result = await this.embeddings.embed(rule.ruleText);
        rule.embedding = result.vector;
      } catch {
        // Embedding generation failed, continue without
      }
    }

    await this.storage.store(rule);
    return rule;
  }

  async learnFromBuildFailure(
    errorMessage: string,
    _errorCode: string | undefined,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null> {
    // Parse common error patterns
    const pattern = this.parseErrorPattern(errorMessage);
    if (!pattern) return null;

    const rule = createMemoryRule(
      "project",
      "anti-pattern",
      "code-pattern",
      pattern.codePattern,
      pattern.ruleText,
      "build-failure",
      {
        ruleExplanation: `Learned from build error: ${errorMessage.substring(0, 100)}`,
        confidence: 0.5,
        sourceSessionId: sessionId,
      }
    );

    // Generate embedding
    if (this.embeddings) {
      try {
        const result = await this.embeddings.embed(rule.ruleText);
        rule.embedding = result.vector;
      } catch {
        // Continue without embedding
      }
    }

    await this.storage.store(rule);
    return rule;
  }

  async learnFromRefactor(
    beforeCode: string,
    afterCode: string,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null> {
    // Similar to correction learning but with higher confidence
    const changes = this.analyzeCodeDiff(beforeCode, afterCode);
    if (changes.length === 0) return null;

    const change = changes[0]!;
    const ext = path.extname(filePath);

    const rule = createMemoryRule(
      "project",
      "architecture",
      "code-pattern",
      change.pattern,
      change.ruleText,
      "manual-refactor",
      {
        ruleExplanation: `Learned from refactoring in ${filePath}`,
        examples: [
          {
            bad: change.original,
            good: change.corrected,
            explanation: "Refactored for better code quality",
          },
        ],
        confidence: 0.7,
        sourceSessionId: sessionId,
      }
    );

    if (this.embeddings) {
      try {
        const result = await this.embeddings.embed(rule.ruleText);
        rule.embedding = result.vector;
      } catch {
        // Continue without embedding
      }
    }

    await this.storage.store(rule);
    return rule;
  }

  async learnFromInstruction(
    instruction: string,
    scope: MemoryRuleScope,
    category: MemoryRuleCategory,
    sessionId: string
  ): Promise<ProjectMemoryRule> {
    // Parse instruction to extract trigger pattern
    const triggerPattern = this.extractTriggerPattern(instruction);

    const rule = createMemoryRule(
      scope,
      category,
      "context-keyword",
      triggerPattern,
      instruction,
      "explicit-instruction",
      {
        confidence: 0.9, // High confidence for explicit instructions
        sourceSessionId: sessionId,
      }
    );

    if (this.embeddings) {
      try {
        const result = await this.embeddings.embed(instruction);
        rule.embedding = result.vector;
      } catch {
        // Continue without embedding
      }
    }

    await this.storage.store(rule);
    return rule;
  }

  async inferPatterns(_minOccurrences: number): Promise<ProjectMemoryRule[]> {
    // TODO: Implement pattern inference from repeated behaviors
    // This would analyze ledger entries for repeated corrections/refactors
    return [];
  }

  private analyzeCodeDiff(
    original: string,
    corrected: string
  ): Array<{ original: string; corrected: string; ruleText: string; pattern: string }> {
    const changes: Array<{ original: string; corrected: string; ruleText: string; pattern: string }> = [];

    // Simple line-by-line diff
    const originalLines = original.split("\n");
    const correctedLines = corrected.split("\n");

    // Find changed lines
    for (let i = 0; i < Math.max(originalLines.length, correctedLines.length); i++) {
      const origLine = originalLines[i] ?? "";
      const corrLine = correctedLines[i] ?? "";

      if (origLine !== corrLine && origLine.trim() && corrLine.trim()) {
        changes.push({
          original: origLine.trim(),
          corrected: corrLine.trim(),
          ruleText: `Prefer "${corrLine.trim()}" over "${origLine.trim()}"`,
          pattern: this.createPatternFromCode(origLine),
        });
        break; // Just take first significant change
      }
    }

    return changes;
  }

  private parseErrorPattern(
    errorMessage: string
  ): { codePattern: string; ruleText: string } | null {
    // Common TypeScript/JavaScript error patterns
    if (errorMessage.includes("is not assignable to type")) {
      return {
        codePattern: "type.*=",
        ruleText: "Ensure type compatibility in assignments",
      };
    }

    if (errorMessage.includes("Cannot find module")) {
      return {
        codePattern: "import.*from",
        ruleText: "Verify module paths and ensure dependencies are installed",
      };
    }

    if (errorMessage.includes("is not a function")) {
      return {
        codePattern: "\\w+\\(",
        ruleText: "Verify function exists before calling",
      };
    }

    return null;
  }

  private extractTriggerPattern(instruction: string): string {
    // Extract keywords from instruction
    const words = instruction.toLowerCase().split(/\s+/);
    const keywords = words.filter(
      (w) => w.length > 3 && !["should", "always", "never", "when", "with", "from"].includes(w)
    );
    return keywords.slice(0, 3).join("|");
  }

  private createPatternFromCode(code: string): string {
    // Create a regex-safe pattern from code
    return code
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s*");
  }
}

// =============================================================================
// Memory Retriever Implementation
// =============================================================================

export class SimpleMemoryRetriever implements IMemoryRetriever {
  private storage: IMemoryStorage;
  private embeddings: EmbeddingService | null;
  private config: ProjectMemoryConfig;

  constructor(storage: IMemoryStorage, config: ProjectMemoryConfig, embeddings?: EmbeddingService) {
    this.storage = storage;
    this.embeddings = embeddings ?? null;
    this.config = config;
  }

  async getRelevantMemories(query: SemanticMemoryQuery): Promise<ProjectMemoryRule[]> {
    const limit = query.limit ?? this.config.defaultRetrievalLimit;
    const results: ProjectMemoryRule[] = [];

    // 1. Try semantic search if embeddings available
    if (this.embeddings && query.context) {
      try {
        const result = await this.embeddings.embed(query.context);
        const semanticResults = await this.storage.searchSemantic(
          result.vector,
          limit,
          query.minSimilarity ?? this.config.minRetrievalSimilarity
        );
        results.push(...semanticResults);
      } catch {
        // Fall back to keyword search
      }
    }

    // 2. Get file-specific rules
    if (query.filePath) {
      const fileRules = await this.getMemoriesForFile(query.filePath);
      for (const rule of fileRules) {
        if (!results.find((r) => r.id === rule.id)) {
          results.push(rule);
        }
      }
    }

    // 3. Get entity-type rules
    if (query.entityType) {
      const entityRules = await this.getMemoriesForEntityType(query.entityType);
      for (const rule of entityRules) {
        if (!results.find((r) => r.id === rule.id)) {
          results.push(rule);
        }
      }
    }

    // Sort by confidence and return top results
    return results
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getMemoriesForFile(filePath: string): Promise<ProjectMemoryRule[]> {
    const ext = path.extname(filePath);
    const dir = path.dirname(filePath);

    const results: ProjectMemoryRule[] = [];

    // Get file pattern matches
    const fileRules = await this.storage.getByTrigger("file-pattern", filePath);
    results.push(...fileRules);

    // Get extension matches
    const extRules = await this.storage.getByTrigger("file-pattern", `*${ext}`);
    for (const rule of extRules) {
      if (!results.find((r) => r.id === rule.id)) {
        results.push(rule);
      }
    }

    // Get directory/module matches
    const moduleRules = await this.storage.query({
      scope: "module",
      scopeTarget: dir,
      isActive: true,
    });
    for (const rule of moduleRules) {
      if (!results.find((r) => r.id === rule.id)) {
        results.push(rule);
      }
    }

    return results;
  }

  async getMemoriesForEntityType(entityType: string): Promise<ProjectMemoryRule[]> {
    return this.storage.getByTrigger("entity-type", entityType);
  }

  async getConventions(scope: MemoryRuleScope, target?: string): Promise<ProjectMemoryRule[]> {
    return this.storage.query({
      scope,
      scopeTarget: target,
      category: "convention",
      isActive: true,
    });
  }

  async getAntiPatterns(scope: MemoryRuleScope, target?: string): Promise<ProjectMemoryRule[]> {
    return this.storage.query({
      scope,
      scopeTarget: target,
      category: "anti-pattern",
      isActive: true,
    });
  }

  formatForPrompt(rules: ProjectMemoryRule[], maxLength = 2000): string {
    if (rules.length === 0) return "";

    const lines: string[] = [];
    lines.push("## Project Rules and Conventions");
    lines.push("");

    let currentLength = lines.join("\n").length;

    for (const rule of rules) {
      const ruleSection = [
        `### ${rule.category}: ${rule.ruleText}`,
        rule.ruleExplanation ? `_${rule.ruleExplanation}_` : "",
        "",
      ].filter(Boolean);

      // Add examples if space allows
      if (rule.examples.length > 0) {
        ruleSection.push("**Examples:**");
        for (const ex of rule.examples.slice(0, 2)) {
          ruleSection.push(`- Bad: \`${ex.bad}\``);
          ruleSection.push(`- Good: \`${ex.good}\``);
        }
        ruleSection.push("");
      }

      const sectionText = ruleSection.join("\n");
      if (currentLength + sectionText.length > maxLength) break;

      lines.push(sectionText);
      currentLength += sectionText.length;
    }

    return lines.join("\n");
  }
}

// =============================================================================
// Main Project Memory Implementation
// =============================================================================

export class CozoProjectMemory implements IProjectMemory {
  private storage: IMemoryStorage;
  private learner: IMemoryLearner;
  private retriever: IMemoryRetriever;
  private ledger: IChangeLedger | null;
  private config: ProjectMemoryConfig;
  private initialized = false;
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    adapter: IStorageAdapter,
    config: ProjectMemoryConfig,
    ledger?: IChangeLedger,
    embeddings?: EmbeddingService
  ) {
    this.storage = new CozoMemoryStorage(adapter);
    this.learner = new SimpleMemoryLearner(this.storage, embeddings);
    this.retriever = new SimpleMemoryRetriever(this.storage, config, embeddings);
    this.ledger = ledger ?? null;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.storage.initialize();

    // Start decay timer if enabled
    if (this.config.enableDecay) {
      this.decayTimer = setInterval(
        () => this.applyConfidenceDecay(),
        this.config.decayIntervalMs
      );
    }

    this.initialized = true;
    logger.info("Project memory initialized");
  }

  get isReady(): boolean {
    return this.initialized;
  }

  // =========================================================================
  // Rule Management
  // =========================================================================

  async createRule(
    scope: MemoryRuleScope,
    category: MemoryRuleCategory,
    triggerType: TriggerType,
    triggerPattern: string,
    ruleText: string,
    source: ProjectMemoryRule["source"],
    options?: {
      scopeTarget?: string;
      ruleExplanation?: string;
      examples?: Array<{ bad: string; good: string; explanation?: string }>;
      confidence?: number;
      sessionId?: string;
      eventId?: string;
    }
  ): Promise<ProjectMemoryRule> {
    const rule = createMemoryRule(scope, category, triggerType, triggerPattern, ruleText, source, {
      scopeTarget: options?.scopeTarget,
      ruleExplanation: options?.ruleExplanation,
      examples: options?.examples,
      confidence: options?.confidence ?? this.config.initialConfidence,
      sourceSessionId: options?.sessionId,
      sourceEventId: options?.eventId,
    });

    await this.storage.store(rule);

    // Log to ledger
    if (this.ledger) {
      const entry = createLedgerEntry(
        "user:feedback:received",
        "user-interface",
        `Memory rule created: ${ruleText.substring(0, 50)}`,
        {
          metadata: {
            ruleId: rule.id,
            scope,
            category,
            action: "created",
          },
          sessionId: options?.sessionId,
        }
      );
      await this.ledger.append(entry);
    }

    return rule;
  }

  async getRule(id: string): Promise<ProjectMemoryRule | null> {
    return this.storage.getById(id);
  }

  async updateRule(id: string, updates: Partial<ProjectMemoryRule>): Promise<ProjectMemoryRule | null> {
    const existing = await this.storage.getById(id);
    if (!existing) return null;

    const updated: ProjectMemoryRule = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.update(updated);
    return updated;
  }

  async deprecateRule(id: string, reason: string): Promise<boolean> {
    const rule = await this.storage.getById(id);
    if (!rule) return false;

    rule.isActive = false;
    rule.deprecatedAt = new Date().toISOString();
    rule.deprecatedReason = reason;
    rule.updatedAt = new Date().toISOString();

    await this.storage.update(rule);

    if (this.ledger) {
      const entry = createLedgerEntry(
        "user:feedback:received",
        "user-interface",
        `Memory rule deprecated: ${rule.ruleText.substring(0, 50)}`,
        {
          metadata: {
            ruleId: id,
            reason,
            action: "deprecated",
          },
        }
      );
      await this.ledger.append(entry);
    }

    return true;
  }

  async deleteRule(id: string): Promise<boolean> {
    return this.storage.delete(id);
  }

  async listRules(query: MemoryQuery): Promise<ProjectMemoryRule[]> {
    return this.storage.query(query);
  }

  // =========================================================================
  // Learning
  // =========================================================================

  async learnFromCorrection(
    originalCode: string,
    correctedCode: string,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null> {
    return this.learner.learnFromCorrection(originalCode, correctedCode, filePath, sessionId);
  }

  async learnFromBuildFailure(
    errorMessage: string,
    errorCode: string | undefined,
    filePath: string,
    sessionId: string
  ): Promise<ProjectMemoryRule | null> {
    return this.learner.learnFromBuildFailure(errorMessage, errorCode, filePath, sessionId);
  }

  async learnFromInstruction(
    instruction: string,
    scope: MemoryRuleScope,
    category: MemoryRuleCategory,
    sessionId: string
  ): Promise<ProjectMemoryRule> {
    return this.learner.learnFromInstruction(instruction, scope, category, sessionId);
  }

  // =========================================================================
  // Retrieval
  // =========================================================================

  async getRelevantMemories(query: SemanticMemoryQuery): Promise<ProjectMemoryRule[]> {
    return this.retriever.getRelevantMemories(query);
  }

  async getMemoriesForFile(filePath: string): Promise<ProjectMemoryRule[]> {
    return this.retriever.getMemoriesForFile(filePath);
  }

  formatForPrompt(rules: ProjectMemoryRule[], maxLength?: number): string {
    return this.retriever.formatForPrompt(rules, maxLength);
  }

  // =========================================================================
  // Validation
  // =========================================================================

  async validateRule(id: string, sessionId?: string): Promise<void> {
    const rule = await this.storage.getById(id);
    if (!rule) return;

    rule.validationCount++;
    rule.lastValidatedAt = new Date().toISOString();
    rule.confidence = Math.min(1, rule.confidence + this.config.validationBoost);
    rule.updatedAt = new Date().toISOString();

    await this.storage.update(rule);

    if (this.ledger) {
      const entry = createLedgerEntry(
        "user:confirmation:received",
        "user-interface",
        `Memory rule validated: ${rule.ruleText.substring(0, 50)}`,
        {
          metadata: {
            ruleId: id,
            newConfidence: rule.confidence,
            action: "validated",
          },
          sessionId,
        }
      );
      await this.ledger.append(entry);
    }
  }

  async recordViolation(id: string, details: string, sessionId?: string): Promise<void> {
    const rule = await this.storage.getById(id);
    if (!rule) return;

    rule.violationCount++;
    rule.lastViolatedAt = new Date().toISOString();
    rule.confidence = Math.max(0, rule.confidence - this.config.violationPenalty);
    rule.updatedAt = new Date().toISOString();

    // Auto-deprecate if confidence too low
    if (rule.confidence < this.config.minActiveConfidence) {
      rule.isActive = false;
      rule.deprecatedAt = new Date().toISOString();
      rule.deprecatedReason = "Confidence dropped below minimum due to violations";
    }

    await this.storage.update(rule);

    if (this.ledger) {
      const entry = createLedgerEntry(
        "user:correction:received",
        "user-interface",
        `Memory rule violated: ${rule.ruleText.substring(0, 50)}`,
        {
          metadata: {
            ruleId: id,
            newConfidence: rule.confidence,
            details,
            action: "violated",
          },
          sessionId,
        }
      );
      await this.ledger.append(entry);
    }
  }

  // =========================================================================
  // Maintenance
  // =========================================================================

  async applyConfidenceDecay(
    options?: { decayFactor?: number; minConfidence?: number }
  ): Promise<number> {
    const decayFactor = options?.decayFactor ?? this.config.decayFactor;
    const minConfidence = options?.minConfidence ?? this.config.minActiveConfidence;

    const updated = await this.storage.applyDecay(decayFactor, minConfidence);
    logger.info({ updated, decayFactor }, "Applied confidence decay");

    return updated;
  }

  async getStats(): Promise<MemoryStats> {
    return this.storage.getStats();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async shutdown(): Promise<void> {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    logger.info("Project memory shut down");
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createMemoryStorage(adapter: IStorageAdapter): IMemoryStorage {
  return new CozoMemoryStorage(adapter);
}

export function createProjectMemory(
  adapter: IStorageAdapter,
  config?: Partial<ProjectMemoryConfig>,
  ledger?: IChangeLedger,
  embeddings?: EmbeddingService
): IProjectMemory {
  return new CozoProjectMemory(
    adapter,
    { ...DEFAULT_MEMORY_CONFIG, ...config },
    ledger,
    embeddings
  );
}
