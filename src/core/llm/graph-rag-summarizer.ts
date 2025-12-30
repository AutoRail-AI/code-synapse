/**
 * GraphRAG Summarizer
 *
 * Implements hierarchical summarization following the GraphRAG pattern:
 * Function → File → Module → System
 *
 * This enables efficient answering of high-level questions like
 * "How does authentication work?" by drilling down through summaries.
 *
 * @module
 */

import { createLogger } from "../../utils/logger.js";
import type { LLMService, JsonSchema } from "./llm-service.js";
import type { GraphDatabase } from "../graph/database.js";

const logger = createLogger("graph-rag-summarizer");

// =============================================================================
// Types
// =============================================================================

export interface FunctionSummary {
  id: string;
  name: string;
  filePath: string;
  summary: string;
  tags: string[];
  confidence: number;
}

export interface FileSummary {
  id: string;
  path: string;
  summary: string;
  purpose: string;
  functionCount: number;
  mainEntities: string[];
  tags: string[];
  confidence: number;
}

export interface ModuleSummary {
  id: string;
  name: string;
  files: string[];
  summary: string;
  responsibilities: string[];
  dependencies: string[];
  tags: string[];
  confidence: number;
}

export interface SystemSummary {
  projectName: string;
  summary: string;
  architecture: string;
  modules: string[];
  keyFeatures: string[];
  techStack: string[];
  confidence: number;
}

export interface SummaryHierarchy {
  system: SystemSummary | null;
  modules: Map<string, ModuleSummary>;
  files: Map<string, FileSummary>;
  functions: Map<string, FunctionSummary>;
}

export interface GraphRAGConfig {
  /** Minimum functions in a file to summarize (default: 2) */
  minFunctionsPerFile?: number;
  /** Minimum files to form a module (default: 3) */
  minFilesPerModule?: number;
  /** Temperature for summarization (default: 0.5) */
  temperature?: number;
}

// =============================================================================
// JSON Schemas
// =============================================================================

const FILE_SUMMARY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    purpose: { type: "string" },
    mainEntities: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
};

const MODULE_SUMMARY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    responsibilities: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
};

const SYSTEM_SUMMARY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    architecture: { type: "string" },
    keyFeatures: { type: "array", items: { type: "string" } },
    techStack: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
};

// =============================================================================
// GraphRAG Summarizer
// =============================================================================

export class GraphRAGSummarizer {
  private llmService: LLMService;
  private graphDb: GraphDatabase;
  private config: Required<GraphRAGConfig>;
  private hierarchy: SummaryHierarchy = {
    system: null,
    modules: new Map(),
    files: new Map(),
    functions: new Map(),
  };

  constructor(
    llmService: LLMService,
    graphDb: GraphDatabase,
    config: GraphRAGConfig = {}
  ) {
    this.llmService = llmService;
    this.graphDb = graphDb;
    this.config = {
      minFunctionsPerFile: config.minFunctionsPerFile ?? 2,
      minFilesPerModule: config.minFilesPerModule ?? 3,
      temperature: config.temperature ?? 0.5,
    };
  }

  /**
   * Build the complete summary hierarchy bottom-up
   */
  async buildHierarchy(
    onProgress?: (phase: string, progress: number) => void
  ): Promise<SummaryHierarchy> {
    logger.info("Building GraphRAG summary hierarchy");

    // Phase 1: Load function summaries from graph
    onProgress?.("loading-functions", 0);
    await this.loadFunctionSummaries();
    onProgress?.("loading-functions", 100);

    // Phase 2: Generate file summaries
    onProgress?.("summarizing-files", 0);
    await this.generateFileSummaries(
      (p) => onProgress?.("summarizing-files", p)
    );

    // Phase 3: Detect and summarize modules
    onProgress?.("summarizing-modules", 0);
    await this.generateModuleSummaries(
      (p) => onProgress?.("summarizing-modules", p)
    );

    // Phase 4: Generate system summary
    onProgress?.("summarizing-system", 0);
    await this.generateSystemSummary();
    onProgress?.("summarizing-system", 100);

    logger.info(
      {
        functions: this.hierarchy.functions.size,
        files: this.hierarchy.files.size,
        modules: this.hierarchy.modules.size,
        hasSystem: this.hierarchy.system !== null,
      },
      "GraphRAG hierarchy built"
    );

    return this.hierarchy;
  }

  /**
   * Load existing function summaries from the graph database
   */
  private async loadFunctionSummaries(): Promise<void> {
    const query = `
      ?[id, name, file_path, business_logic, inference_confidence] :=
        *function{id, name, file_id, business_logic, inference_confidence},
        *file{id: file_id, path: file_path},
        business_logic != ''
    `;

    interface FunctionRow {
      id: string;
      name: string;
      file_path: string;
      business_logic: string;
      inference_confidence: number;
    }

    try {
      const results = await this.graphDb.query<FunctionRow>(query);

      for (const row of results) {
        // Parse business logic JSON to extract summary and tags
        let summary = row.business_logic;
        let tags: string[] = [];

        try {
          const parsed = JSON.parse(row.business_logic);
          summary = parsed.summary || row.business_logic;
          tags = parsed.tags || [];
        } catch {
          // Use raw business_logic as summary
        }

        this.hierarchy.functions.set(row.id, {
          id: row.id,
          name: row.name,
          filePath: row.file_path,
          summary,
          tags,
          confidence: row.inference_confidence || 0.5,
        });
      }

      logger.debug(
        { count: this.hierarchy.functions.size },
        "Loaded function summaries"
      );
    } catch (error) {
      logger.warn({ error }, "Failed to load function summaries");
    }
  }

  /**
   * Generate summaries for files based on their functions
   */
  private async generateFileSummaries(
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // Get all files with their function counts
    const fileQuery = `
      ?[file_id, path, func_count] :=
        *file{id: file_id, path},
        func_count = count(func_id),
        *contains{from_id: file_id, to_id: func_id},
        *function{id: func_id}
    `;

    interface FileRow {
      file_id: string;
      path: string;
      func_count: number;
    }

    try {
      const files = await this.graphDb.query<FileRow>(fileQuery);
      const eligibleFiles = files.filter(
        (f) => f.func_count >= this.config.minFunctionsPerFile
      );

      for (let i = 0; i < eligibleFiles.length; i++) {
        const file = eligibleFiles[i]!;

        // Get function summaries for this file
        const fileFunctions = Array.from(this.hierarchy.functions.values())
          .filter((f) => f.filePath === file.path);

        if (fileFunctions.length === 0) {
          continue;
        }

        // Generate file summary
        const fileSummary = await this.summarizeFile(
          file.file_id,
          file.path,
          fileFunctions
        );

        if (fileSummary) {
          this.hierarchy.files.set(file.file_id, fileSummary);
        }

        onProgress?.(((i + 1) / eligibleFiles.length) * 100);
      }
    } catch (error) {
      logger.error({ error }, "Failed to generate file summaries");
    }
  }

  /**
   * Generate a summary for a single file
   */
  private async summarizeFile(
    fileId: string,
    filePath: string,
    functions: FunctionSummary[]
  ): Promise<FileSummary | null> {
    if (!this.llmService.isReady()) {
      // Fallback: combine function summaries
      const combinedTags = [...new Set(functions.flatMap((f) => f.tags))];
      const avgConfidence =
        functions.reduce((sum, f) => sum + f.confidence, 0) / functions.length;

      return {
        id: fileId,
        path: filePath,
        summary: `Contains ${functions.length} functions: ${functions.map((f) => f.name).join(", ")}`,
        purpose: "Code file",
        functionCount: functions.length,
        mainEntities: functions.map((f) => f.name).slice(0, 5),
        tags: combinedTags.slice(0, 5),
        confidence: avgConfidence * 0.5, // Lower confidence for fallback
      };
    }

    const prompt = `Summarize this code file based on its functions:

File: ${filePath}

Functions:
${functions.map((f) => `- ${f.name}: ${f.summary}`).join("\n")}

Provide a JSON summary with: summary, purpose, mainEntities, tags, confidence`;

    try {
      const result = await this.llmService.complete(prompt, {
        maxTokens: 200,
        temperature: this.config.temperature,
        jsonSchema: FILE_SUMMARY_SCHEMA,
      });

      const parsed = result.parsed as {
        summary: string;
        purpose: string;
        mainEntities?: string[];
        tags: string[];
        confidence: number;
      };

      return {
        id: fileId,
        path: filePath,
        summary: parsed.summary,
        purpose: parsed.purpose,
        functionCount: functions.length,
        mainEntities: parsed.mainEntities || functions.map((f) => f.name).slice(0, 5),
        tags: parsed.tags,
        confidence: parsed.confidence,
      };
    } catch (error) {
      logger.warn({ error, filePath }, "Failed to summarize file");
      return null;
    }
  }

  /**
   * Detect modules based on import clustering and generate summaries
   */
  private async generateModuleSummaries(
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // Detect modules by directory structure
    const modules = this.detectModulesByDirectory();

    let completed = 0;
    for (const [moduleName, filePaths] of modules) {
      if (filePaths.length < this.config.minFilesPerModule) {
        continue;
      }

      const moduleSummary = await this.summarizeModule(moduleName, filePaths);
      if (moduleSummary) {
        this.hierarchy.modules.set(moduleName, moduleSummary);
      }

      completed++;
      onProgress?.((completed / modules.size) * 100);
    }
  }

  /**
   * Detect modules by grouping files by their directory
   */
  private detectModulesByDirectory(): Map<string, string[]> {
    const modules = new Map<string, string[]>();

    for (const [_, fileSummary] of this.hierarchy.files) {
      // Extract directory from path
      const parts = fileSummary.path.split("/");
      parts.pop(); // Remove filename
      const _dirPath = parts.join("/");

      // Use the last two directory components as module name
      const moduleName = parts.slice(-2).join("/") || "root";

      if (!modules.has(moduleName)) {
        modules.set(moduleName, []);
      }
      modules.get(moduleName)!.push(fileSummary.path);
    }

    return modules;
  }

  /**
   * Generate a summary for a module
   */
  private async summarizeModule(
    moduleName: string,
    filePaths: string[]
  ): Promise<ModuleSummary | null> {
    const fileSummaries = filePaths
      .map((path) => {
        const entry = Array.from(this.hierarchy.files.values()).find(
          (f) => f.path === path
        );
        return entry;
      })
      .filter((f): f is FileSummary => f !== undefined);

    if (fileSummaries.length === 0) {
      return null;
    }

    // Get dependencies from imports
    const dependencies = await this.getModuleDependencies(filePaths);

    if (!this.llmService.isReady()) {
      // Fallback summary
      const combinedTags = [...new Set(fileSummaries.flatMap((f) => f.tags))];
      const avgConfidence =
        fileSummaries.reduce((sum, f) => sum + f.confidence, 0) / fileSummaries.length;

      return {
        id: `module:${moduleName}`,
        name: moduleName,
        files: filePaths,
        summary: `Module containing ${filePaths.length} files`,
        responsibilities: fileSummaries.map((f) => f.purpose).slice(0, 5),
        dependencies,
        tags: combinedTags.slice(0, 5),
        confidence: avgConfidence * 0.5,
      };
    }

    const prompt = `Summarize this code module based on its files:

Module: ${moduleName}

Files:
${fileSummaries.map((f) => `- ${f.path}: ${f.summary}`).join("\n")}

Dependencies: ${dependencies.join(", ") || "none"}

Provide a JSON summary with: summary, responsibilities, tags, confidence`;

    try {
      const result = await this.llmService.complete(prompt, {
        maxTokens: 200,
        temperature: this.config.temperature,
        jsonSchema: MODULE_SUMMARY_SCHEMA,
      });

      const parsed = result.parsed as {
        summary: string;
        responsibilities: string[];
        tags: string[];
        confidence: number;
      };

      return {
        id: `module:${moduleName}`,
        name: moduleName,
        files: filePaths,
        summary: parsed.summary,
        responsibilities: parsed.responsibilities,
        dependencies,
        tags: parsed.tags,
        confidence: parsed.confidence,
      };
    } catch (error) {
      logger.warn({ error, moduleName }, "Failed to summarize module");
      return null;
    }
  }

  /**
   * Get external dependencies for a set of files
   */
  private async getModuleDependencies(filePaths: string[]): Promise<string[]> {
    const dependencies = new Set<string>();

    // Query imports for these files
    for (const filePath of filePaths) {
      const query = `
        ?[imported_path] :=
          *file{id: file_id, path},
          path = $filePath,
          *imports{from_id: file_id, to_id: imported_id},
          *file{id: imported_id, path: imported_path}
      `;

      try {
        const results = await this.graphDb.query<{ imported_path: string }>(
          query,
          { filePath }
        );

        for (const row of results) {
          // Check if imported file is outside this module
          if (!filePaths.includes(row.imported_path)) {
            // Extract module name from path
            const parts = row.imported_path.split("/");
            const moduleName = parts.slice(-2, -1)[0] || "external";
            dependencies.add(moduleName);
          }
        }
      } catch {
        // Ignore query errors
      }
    }

    return Array.from(dependencies);
  }

  /**
   * Generate the system-level summary
   */
  private async generateSystemSummary(): Promise<void> {
    const modules = Array.from(this.hierarchy.modules.values());

    if (modules.length === 0) {
      logger.debug("No modules to summarize for system");
      return;
    }

    if (!this.llmService.isReady()) {
      // Fallback summary
      const _combinedTags = [...new Set(modules.flatMap((m) => m.tags))]; // Reserved for future use

      this.hierarchy.system = {
        projectName: "Project",
        summary: `Project with ${modules.length} modules and ${this.hierarchy.files.size} files`,
        architecture: "Unknown",
        modules: modules.map((m) => m.name),
        keyFeatures: modules.flatMap((m) => m.responsibilities).slice(0, 10),
        techStack: ["TypeScript"],
        confidence: 0.3,
      };
      return;
    }

    const prompt = `Summarize this software project based on its modules:

Modules:
${modules.map((m) => `- ${m.name}: ${m.summary}`).join("\n")}

Total files: ${this.hierarchy.files.size}
Total functions: ${this.hierarchy.functions.size}

Provide a JSON summary with: summary, architecture, keyFeatures, techStack, confidence`;

    try {
      const result = await this.llmService.complete(prompt, {
        maxTokens: 300,
        temperature: this.config.temperature,
        jsonSchema: SYSTEM_SUMMARY_SCHEMA,
      });

      const parsed = result.parsed as {
        summary: string;
        architecture: string;
        keyFeatures: string[];
        techStack?: string[];
        confidence: number;
      };

      this.hierarchy.system = {
        projectName: "Project",
        summary: parsed.summary,
        architecture: parsed.architecture,
        modules: modules.map((m) => m.name),
        keyFeatures: parsed.keyFeatures,
        techStack: parsed.techStack || ["TypeScript"],
        confidence: parsed.confidence,
      };
    } catch (error) {
      logger.error({ error }, "Failed to generate system summary");
    }
  }

  /**
   * Query the hierarchy for relevant context
   */
  queryHierarchy(query: string): {
    system?: SystemSummary;
    modules: ModuleSummary[];
    files: FileSummary[];
    functions: FunctionSummary[];
  } {
    const queryLower = query.toLowerCase();
    const result: ReturnType<typeof this.queryHierarchy> = {
      modules: [],
      files: [],
      functions: [],
    };

    // Include system summary if available
    if (this.hierarchy.system) {
      result.system = this.hierarchy.system;
    }

    // Search modules by name and tags
    for (const module of this.hierarchy.modules.values()) {
      if (
        module.name.toLowerCase().includes(queryLower) ||
        module.tags.some((t) => t.includes(queryLower)) ||
        module.summary.toLowerCase().includes(queryLower)
      ) {
        result.modules.push(module);
      }
    }

    // Search files by path and tags
    for (const file of this.hierarchy.files.values()) {
      if (
        file.path.toLowerCase().includes(queryLower) ||
        file.tags.some((t) => t.includes(queryLower)) ||
        file.summary.toLowerCase().includes(queryLower)
      ) {
        result.files.push(file);
      }
    }

    // Search functions by name and tags
    for (const func of this.hierarchy.functions.values()) {
      if (
        func.name.toLowerCase().includes(queryLower) ||
        func.tags.some((t) => t.includes(queryLower)) ||
        func.summary.toLowerCase().includes(queryLower)
      ) {
        result.functions.push(func);
      }
    }

    return result;
  }

  /**
   * Get the current hierarchy
   */
  getHierarchy(): SummaryHierarchy {
    return this.hierarchy;
  }
}

/**
 * Create a GraphRAG summarizer
 */
export function createGraphRAGSummarizer(
  llmService: LLMService,
  graphDb: GraphDatabase,
  config?: GraphRAGConfig
): GraphRAGSummarizer {
  return new GraphRAGSummarizer(llmService, graphDb, config);
}
