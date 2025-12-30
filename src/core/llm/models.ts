/**
 * LLM Model Registry
 *
 * Defines available models for local inference with their specifications.
 * Supports both Qwen and Llama model families.
 *
 * @module
 */

import { createLogger } from "../../utils/logger.js";
import { resolveModelFile } from "node-llama-cpp";
import * as path from "node:path";
import * as fs from "node:fs";

const logger = createLogger("llm-models");

// =============================================================================
// Model Definitions
// =============================================================================

export type ModelFamily = "qwen" | "llama" | "codellama" | "deepseek";
export type ModelSize = "tiny" | "small" | "medium" | "large";
export type ModelTask = "code" | "general" | "instruct";

export interface ModelSpec {
  /** Unique model identifier */
  id: string;
  /** Display name */
  name: string;
  /** Model family */
  family: ModelFamily;
  /** Model size category */
  size: ModelSize;
  /** Primary task */
  task: ModelTask;
  /** Parameter count (e.g., "1.5B", "7B") */
  parameters: string;
  /** Approximate GGUF file size in GB */
  fileSizeGb: number;
  /** Minimum RAM required in GB */
  minRamGb: number;
  /** Recommended context size */
  contextSize: number;
  /** HuggingFace repo ID */
  huggingFaceRepo: string;
  /** GGUF filename to download */
  fileName: string;
  /** Brief description */
  description: string;
  /** Whether this is a code-specialized model */
  codeOptimized: boolean;
  /** Quality score for code tasks (1-10) */
  codeQuality: number;
  /** Speed score (1-10, higher = faster) */
  speed: number;
}

/**
 * Registry of supported models
 */
export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // =========================================================================
  // Qwen 2.5 Coder Series (RECOMMENDED for code tasks)
  // Best-in-class for code understanding and generation
  // =========================================================================
  "qwen2.5-coder-0.5b": {
    id: "qwen2.5-coder-0.5b",
    name: "Qwen 2.5 Coder 0.5B",
    family: "qwen",
    size: "tiny",
    task: "code",
    parameters: "0.5B",
    fileSizeGb: 0.4,
    minRamGb: 1,
    contextSize: 4096,
    huggingFaceRepo: "Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF",
    fileName: "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
    description: "Tiny but capable. Best for: quick summaries on resource-constrained systems. Runs on any machine.",
    codeOptimized: true,
    codeQuality: 5,
    speed: 10,
  },

  "qwen2.5-coder-1.5b": {
    id: "qwen2.5-coder-1.5b",
    name: "Qwen 2.5 Coder 1.5B",
    family: "qwen",
    size: "small",
    task: "code",
    parameters: "1.5B",
    fileSizeGb: 1.0,
    minRamGb: 2,
    contextSize: 4096,
    huggingFaceRepo: "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
    fileName: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    description: "Sweet spot for laptops. Best for: code summaries with good accuracy. Fast inference on CPU.",
    codeOptimized: true,
    codeQuality: 7,
    speed: 9,
  },

  "qwen2.5-coder-3b": {
    id: "qwen2.5-coder-3b",
    name: "Qwen 2.5 Coder 3B",
    family: "qwen",
    size: "small",
    task: "code",
    parameters: "3B",
    fileSizeGb: 2.0,
    minRamGb: 4,
    contextSize: 4096,
    huggingFaceRepo: "Qwen/Qwen2.5-Coder-3B-Instruct-GGUF",
    fileName: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    description: "RECOMMENDED DEFAULT. Best for: most users. Excellent code understanding with fast inference.",
    codeOptimized: true,
    codeQuality: 8,
    speed: 8,
  },

  "qwen2.5-coder-7b": {
    id: "qwen2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B",
    family: "qwen",
    size: "medium",
    task: "code",
    parameters: "7B",
    fileSizeGb: 4.5,
    minRamGb: 8,
    contextSize: 8192,
    huggingFaceRepo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    fileName: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    description: "Production quality. Best for: detailed code analysis, complex logic inference. Needs good CPU/GPU.",
    codeOptimized: true,
    codeQuality: 9,
    speed: 6,
  },

  "qwen2.5-coder-14b": {
    id: "qwen2.5-coder-14b",
    name: "Qwen 2.5 Coder 14B",
    family: "qwen",
    size: "large",
    task: "code",
    parameters: "14B",
    fileSizeGb: 9.0,
    minRamGb: 16,
    contextSize: 8192,
    huggingFaceRepo: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    fileName: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    description: "Maximum code quality. Best for: enterprise-grade analysis. Requires 16GB+ RAM or GPU.",
    codeOptimized: true,
    codeQuality: 10,
    speed: 4,
  },

  // =========================================================================
  // Llama 3.2 Series (Meta's latest compact models)
  // Good general-purpose, but not code-specialized
  // =========================================================================
  "llama-3.2-1b": {
    id: "llama-3.2-1b",
    name: "Llama 3.2 1B",
    family: "llama",
    size: "tiny",
    task: "instruct",
    parameters: "1B",
    fileSizeGb: 0.7,
    minRamGb: 2,
    contextSize: 4096,
    huggingFaceRepo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
    fileName: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    description: "Meta's smallest Llama. Best for: general text tasks. OK for code, not specialized.",
    codeOptimized: false,
    codeQuality: 4,
    speed: 10,
  },

  "llama-3.2-3b": {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    family: "llama",
    size: "small",
    task: "instruct",
    parameters: "3B",
    fileSizeGb: 2.0,
    minRamGb: 4,
    contextSize: 4096,
    huggingFaceRepo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    fileName: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    description: "Compact Llama 3.2. Best for: general tasks, basic code understanding. Prefer Qwen for code.",
    codeOptimized: false,
    codeQuality: 6,
    speed: 8,
  },

  // =========================================================================
  // Llama 3.1 Series (Proven, reliable)
  // =========================================================================
  "llama-3.1-8b": {
    id: "llama-3.1-8b",
    name: "Llama 3.1 8B",
    family: "llama",
    size: "medium",
    task: "instruct",
    parameters: "8B",
    fileSizeGb: 4.9,
    minRamGb: 8,
    contextSize: 8192,
    huggingFaceRepo: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
    fileName: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    description: "Industry standard. Best for: versatile general-purpose tasks. Good but not code-specialized.",
    codeOptimized: false,
    codeQuality: 7,
    speed: 6,
  },

  // =========================================================================
  // CodeLlama Series (Meta's code-specialized Llama)
  // Older but proven for code tasks
  // =========================================================================
  "codellama-7b": {
    id: "codellama-7b",
    name: "CodeLlama 7B",
    family: "codellama",
    size: "medium",
    task: "code",
    parameters: "7B",
    fileSizeGb: 4.0,
    minRamGb: 8,
    contextSize: 4096,
    huggingFaceRepo: "TheBloke/CodeLlama-7B-Instruct-GGUF",
    fileName: "codellama-7b-instruct.Q4_K_M.gguf",
    description: "Meta's original code model. Best for: proven code tasks. Older, consider Qwen 2.5 instead.",
    codeOptimized: true,
    codeQuality: 7,
    speed: 6,
  },

  "codellama-13b": {
    id: "codellama-13b",
    name: "CodeLlama 13B",
    family: "codellama",
    size: "large",
    task: "code",
    parameters: "13B",
    fileSizeGb: 7.9,
    minRamGb: 16,
    contextSize: 4096,
    huggingFaceRepo: "TheBloke/CodeLlama-13B-Instruct-GGUF",
    fileName: "codellama-13b-instruct.Q4_K_M.gguf",
    description: "Larger CodeLlama. Best for: complex code if you prefer Meta models. Heavy resource usage.",
    codeOptimized: true,
    codeQuality: 8,
    speed: 4,
  },

  // =========================================================================
  // DeepSeek Coder Series (Chinese model, strong code performance)
  // Good alternative to Qwen
  // =========================================================================
  "deepseek-coder-1.3b": {
    id: "deepseek-coder-1.3b",
    name: "DeepSeek Coder 1.3B",
    family: "deepseek",
    size: "small",
    task: "code",
    parameters: "1.3B",
    fileSizeGb: 0.8,
    minRamGb: 2,
    contextSize: 4096,
    huggingFaceRepo: "TheBloke/deepseek-coder-1.3b-instruct-GGUF",
    fileName: "deepseek-coder-1.3b-instruct.Q4_K_M.gguf",
    description: "Efficient code model. Best for: quick inference with decent quality. Alternative to Qwen 1.5B.",
    codeOptimized: true,
    codeQuality: 6,
    speed: 9,
  },

  "deepseek-coder-6.7b": {
    id: "deepseek-coder-6.7b",
    name: "DeepSeek Coder 6.7B",
    family: "deepseek",
    size: "medium",
    task: "code",
    parameters: "6.7B",
    fileSizeGb: 4.0,
    minRamGb: 8,
    contextSize: 4096,
    huggingFaceRepo: "TheBloke/deepseek-coder-6.7b-instruct-GGUF",
    fileName: "deepseek-coder-6.7b-instruct.Q4_K_M.gguf",
    description: "Strong coder. Best for: detailed code understanding. Comparable to Qwen 7B, different strengths.",
    codeOptimized: true,
    codeQuality: 8,
    speed: 6,
  },
};

// =============================================================================
// Model Selection Helpers
// =============================================================================

/**
 * Get all available models
 */
export function getAvailableModels(): ModelSpec[] {
  return Object.values(MODEL_REGISTRY);
}

/**
 * Get model by ID
 */
export function getModelById(id: string): ModelSpec | undefined {
  return MODEL_REGISTRY[id];
}

/**
 * Filter models by criteria
 */
export function filterModels(criteria: {
  family?: ModelFamily;
  size?: ModelSize;
  task?: ModelTask;
  maxRamGb?: number;
  codeOptimized?: boolean;
}): ModelSpec[] {
  return getAvailableModels().filter((model) => {
    if (criteria.family && model.family !== criteria.family) return false;
    if (criteria.size && model.size !== criteria.size) return false;
    if (criteria.task && model.task !== criteria.task) return false;
    if (criteria.maxRamGb && model.minRamGb > criteria.maxRamGb) return false;
    if (criteria.codeOptimized !== undefined && model.codeOptimized !== criteria.codeOptimized) return false;
    return true;
  });
}

/**
 * Get recommended model based on available RAM
 */
export function getRecommendedModel(availableRamGb: number, preferCode = true): ModelSpec {
  const models = filterModels({
    maxRamGb: availableRamGb,
    codeOptimized: preferCode ? true : undefined,
  });

  if (models.length === 0) {
    // Fallback to smallest model
    return MODEL_REGISTRY["qwen2.5-coder-0.5b"]!;
  }

  // Sort by code quality (descending), then by speed (descending)
  models.sort((a, b) => {
    if (b.codeQuality !== a.codeQuality) {
      return b.codeQuality - a.codeQuality;
    }
    return b.speed - a.speed;
  });

  return models[0]!;
}

/**
 * Get models grouped by family
 */
export function getModelsByFamily(): Record<ModelFamily, ModelSpec[]> {
  const result: Record<ModelFamily, ModelSpec[]> = {
    qwen: [],
    llama: [],
    codellama: [],
    deepseek: [],
  };

  for (const model of getAvailableModels()) {
    result[model.family].push(model);
  }

  return result;
}

/**
 * Format model info for display
 */
export function formatModelInfo(model: ModelSpec): string {
  const lines = [
    `${model.name} (${model.parameters})`,
    `  Family: ${model.family}`,
    `  Size: ~${model.fileSizeGb}GB | Min RAM: ${model.minRamGb}GB`,
    `  Code Quality: ${"★".repeat(Math.floor(model.codeQuality / 2))}${"☆".repeat(5 - Math.floor(model.codeQuality / 2))} (${model.codeQuality}/10)`,
    `  Speed: ${"★".repeat(Math.floor(model.speed / 2))}${"☆".repeat(5 - Math.floor(model.speed / 2))} (${model.speed}/10)`,
    `  ${model.description}`,
  ];
  return lines.join("\n");
}

/**
 * Print comparison table of models
 */
export function printModelComparison(models?: ModelSpec[]): string {
  const modelList = models ?? getAvailableModels();

  const headers = ["Model", "Params", "Size", "RAM", "Code", "Speed", "Description"];
  const rows = modelList.map((m) => [
    m.id,
    m.parameters,
    `${m.fileSizeGb}GB`,
    `${m.minRamGb}GB`,
    `${m.codeQuality}/10`,
    `${m.speed}/10`,
    m.description.substring(0, 30),
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length))
  );

  // Format table
  const separator = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const formatRow = (cells: string[]) =>
    "|" + cells.map((c, i) => ` ${c.padEnd(widths[i]!)} `).join("|") + "|";

  const lines = [
    separator,
    formatRow(headers),
    separator,
    ...rows.map(formatRow),
    separator,
  ];

  return lines.join("\n");
}

// =============================================================================
// Model Resolution & Download
// =============================================================================

export interface ModelResolution {
  /** Resolved local path to the model file */
  path: string;
  /** Whether the model was downloaded */
  wasDownloaded: boolean;
  /** Model spec */
  spec: ModelSpec;
}

/**
 * Get the default models directory
 */
export function getModelsDirectory(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".code-synapse", "models");
}

/**
 * Check if a model is already downloaded
 */
export function isModelDownloaded(modelId: string, modelsDir?: string): boolean {
  const model = getModelById(modelId);
  if (!model) return false;

  const dir = modelsDir ?? getModelsDirectory();
  const modelPath = path.join(dir, model.fileName);
  return fs.existsSync(modelPath);
}

/**
 * Get local path for a model (whether downloaded or not)
 */
export function getModelPath(modelId: string, modelsDir?: string): string {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const dir = modelsDir ?? getModelsDirectory();
  return path.join(dir, model.fileName);
}

/**
 * Resolve a model - download if necessary
 *
 * @param modelId - Model ID from registry
 * @param options - Resolution options
 */
export async function resolveModel(
  modelId: string,
  options: {
    modelsDir?: string;
    onProgress?: (progress: { percent: number; downloadedBytes: number; totalBytes: number }) => void;
  } = {}
): Promise<ModelResolution> {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}. Available: ${Object.keys(MODEL_REGISTRY).join(", ")}`);
  }

  const modelsDir = options.modelsDir ?? getModelsDirectory();
  const localPath = path.join(modelsDir, model.fileName);

  // Check if already downloaded
  if (fs.existsSync(localPath)) {
    logger.info({ modelId, path: localPath }, "Model already downloaded");
    return {
      path: localPath,
      wasDownloaded: false,
      spec: model,
    };
  }

  // Ensure models directory exists
  fs.mkdirSync(modelsDir, { recursive: true });

  // Download using node-llama-cpp's resolver
  logger.info({ modelId, repo: model.huggingFaceRepo }, "Downloading model");

  try {
    const resolvedPath = await resolveModelFile(
      `hf:${model.huggingFaceRepo}/${model.fileName}`,
      {
        directory: modelsDir,
        fileName: model.fileName,
        onProgress: options.onProgress
          ? (status) => {
              if (status.downloadedSize && status.totalSize) {
                options.onProgress!({
                  percent: (status.downloadedSize / status.totalSize) * 100,
                  downloadedBytes: status.downloadedSize,
                  totalBytes: status.totalSize,
                });
              }
            }
          : undefined,
      }
    );

    logger.info({ modelId, path: resolvedPath }, "Model downloaded successfully");

    return {
      path: resolvedPath,
      wasDownloaded: true,
      spec: model,
    };
  } catch (error) {
    logger.error({ error, modelId }, "Failed to download model");
    throw error;
  }
}

/**
 * List downloaded models
 */
export function listDownloadedModels(modelsDir?: string): ModelSpec[] {
  const dir = modelsDir ?? getModelsDirectory();

  if (!fs.existsSync(dir)) {
    return [];
  }

  const downloaded: ModelSpec[] = [];
  for (const model of getAvailableModels()) {
    const modelPath = path.join(dir, model.fileName);
    if (fs.existsSync(modelPath)) {
      downloaded.push(model);
    }
  }

  return downloaded;
}

// =============================================================================
// Presets
// =============================================================================

export const MODEL_PRESETS = {
  /** Fastest inference, minimal quality */
  fastest: "qwen2.5-coder-0.5b",
  /** Good balance of speed and quality (recommended) */
  balanced: "qwen2.5-coder-3b",
  /** Best code quality */
  quality: "qwen2.5-coder-7b",
  /** Maximum quality (requires 16GB+ RAM) */
  maximum: "qwen2.5-coder-14b",
  /** Best for limited hardware (2GB RAM) */
  minimal: "qwen2.5-coder-1.5b",
} as const;

export type ModelPreset = keyof typeof MODEL_PRESETS;

/**
 * Get model from preset name
 */
export function getModelFromPreset(preset: ModelPreset): ModelSpec {
  const modelId = MODEL_PRESETS[preset];
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Preset model not found: ${preset} -> ${modelId}`);
  }
  return model;
}

// =============================================================================
// Model Selection Guide
// =============================================================================

/**
 * Get a human-readable model selection guide
 */
export function getModelSelectionGuide(): string {
  return `
================================================================================
                         CODE-SYNAPSE MODEL SELECTION GUIDE
================================================================================

Choose a model based on your hardware and quality requirements.

QUICK RECOMMENDATIONS:
----------------------
  • Laptop (4GB RAM):     qwen2.5-coder-1.5b  - Fast, good quality
  • Desktop (8GB RAM):    qwen2.5-coder-3b    - RECOMMENDED DEFAULT
  • Workstation (16GB+):  qwen2.5-coder-7b    - Production quality
  • Server (32GB+):       qwen2.5-coder-14b   - Maximum quality

BY USE CASE:
------------
  • Fast summaries, low resources:  qwen2.5-coder-0.5b or deepseek-coder-1.3b
  • Daily development:              qwen2.5-coder-3b (recommended)
  • Code review & analysis:         qwen2.5-coder-7b or deepseek-coder-6.7b
  • Enterprise/production:          qwen2.5-coder-14b

MODEL FAMILIES:
---------------
  QWEN 2.5 CODER (Recommended)
    • Best-in-class for code tasks
    • Trained specifically on code
    • Sizes: 0.5B, 1.5B, 3B, 7B, 14B

  LLAMA 3.x (Meta)
    • General-purpose models
    • Good but not code-specialized
    • Choose if you prefer Meta models

  CODELLAMA (Meta)
    • Older code-specialized Llama
    • Proven but superseded by Qwen 2.5

  DEEPSEEK CODER
    • Strong alternative to Qwen
    • Good for diverse code styles

HARDWARE REQUIREMENTS:
----------------------
  Model Size    RAM Needed    Disk Space    Speed
  ----------    ----------    ----------    -----
  0.5B-1.5B     2GB           0.4-1GB       Very Fast
  3B            4GB           2GB           Fast
  6-7B          8GB           4-5GB         Moderate
  13-14B        16GB          8-9GB         Slower

TIP: Start with qwen2.5-coder-3b and upgrade if you need more quality.

================================================================================
`.trim();
}

/**
 * Get recommendation based on system RAM
 */
export function getRecommendationForSystem(): {
  recommended: ModelSpec;
  alternatives: ModelSpec[];
  reason: string;
} {
  // Try to detect available RAM (rough estimate)
  const totalMemory = process.memoryUsage().heapTotal;
  const estimatedRamGb = Math.max(4, Math.floor(totalMemory / 1024 / 1024 / 1024) * 4);

  let recommended: ModelSpec;
  let alternatives: ModelSpec[];
  let reason: string;

  if (estimatedRamGb >= 16) {
    recommended = MODEL_REGISTRY["qwen2.5-coder-7b"]!;
    alternatives = [
      MODEL_REGISTRY["qwen2.5-coder-14b"]!,
      MODEL_REGISTRY["deepseek-coder-6.7b"]!,
    ];
    reason = "You have good RAM. Recommended for production-quality code analysis.";
  } else if (estimatedRamGb >= 8) {
    recommended = MODEL_REGISTRY["qwen2.5-coder-3b"]!;
    alternatives = [
      MODEL_REGISTRY["qwen2.5-coder-7b"]!,
      MODEL_REGISTRY["deepseek-coder-6.7b"]!,
    ];
    reason = "Good balance of quality and speed for your system.";
  } else if (estimatedRamGb >= 4) {
    recommended = MODEL_REGISTRY["qwen2.5-coder-1.5b"]!;
    alternatives = [
      MODEL_REGISTRY["qwen2.5-coder-3b"]!,
      MODEL_REGISTRY["deepseek-coder-1.3b"]!,
    ];
    reason = "Optimized for limited RAM while maintaining good quality.";
  } else {
    recommended = MODEL_REGISTRY["qwen2.5-coder-0.5b"]!;
    alternatives = [
      MODEL_REGISTRY["qwen2.5-coder-1.5b"]!,
      MODEL_REGISTRY["llama-3.2-1b"]!,
    ];
    reason = "Lightweight model for resource-constrained systems.";
  }

  return { recommended, alternatives, reason };
}
