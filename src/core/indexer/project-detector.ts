/**
 * Project Detector
 *
 * Automatic detection of project type, framework, language, and configuration.
 * Analyzes package.json and project structure to determine optimal indexing settings.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileExists } from "../../utils/fs.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Detected framework type
 * Named differently from types/index.ts to avoid export conflicts
 */
export type DetectedFramework =
  | "nextjs"
  | "react"
  | "vue"
  | "angular"
  | "express"
  | "nestjs"
  | "fastify"
  | "koa"
  | "hono"
  | "astro"
  | "svelte"
  | "remix"
  | "nuxt"
  | "electron"
  | "unknown";

/**
 * Primary language used in the project
 * Named differently from types/index.ts to avoid export conflicts
 */
export type DetectedLanguage = "typescript" | "javascript" | "mixed";

/**
 * Project type classification
 */
export type ProjectType =
  | "frontend"
  | "backend"
  | "fullstack"
  | "library"
  | "cli"
  | "monorepo"
  | "unknown";

/**
 * Detected project configuration
 */
export interface DetectedProject {
  /** Root directory of the project */
  rootPath: string;
  /** Project name from package.json */
  name: string;
  /** Project version */
  version: string;
  /** Detected framework */
  framework: DetectedFramework;
  /** Primary language */
  language: DetectedLanguage;
  /** Project type classification */
  projectType: ProjectType;
  /** Whether TypeScript is used */
  hasTypeScript: boolean;
  /** Path to tsconfig.json if exists */
  tsconfigPath: string | null;
  /** Source file patterns to index */
  sourcePatterns: string[];
  /** Patterns to ignore */
  ignorePatterns: string[];
  /** Detected entry points */
  entryPoints: string[];
  /** Package manager used */
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  /** Whether this is a monorepo */
  isMonorepo: boolean;
  /** Workspace paths if monorepo */
  workspaces: string[];
}

/**
 * Raw package.json structure (partial)
 */
interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  types?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Framework detection rules
 */
const FRAMEWORK_DETECTION: Array<{
  framework: DetectedFramework;
  packages: string[];
  priority: number;
}> = [
  // Full-stack frameworks (higher priority)
  { framework: "nextjs", packages: ["next"], priority: 10 },
  { framework: "remix", packages: ["@remix-run/react", "@remix-run/node"], priority: 10 },
  { framework: "nuxt", packages: ["nuxt", "nuxt3"], priority: 10 },
  { framework: "astro", packages: ["astro"], priority: 10 },

  // Frontend frameworks
  { framework: "react", packages: ["react", "react-dom"], priority: 5 },
  { framework: "vue", packages: ["vue"], priority: 5 },
  { framework: "angular", packages: ["@angular/core"], priority: 5 },
  { framework: "svelte", packages: ["svelte"], priority: 5 },

  // Backend frameworks
  { framework: "nestjs", packages: ["@nestjs/core"], priority: 8 },
  { framework: "express", packages: ["express"], priority: 3 },
  { framework: "fastify", packages: ["fastify"], priority: 3 },
  { framework: "koa", packages: ["koa"], priority: 3 },
  { framework: "hono", packages: ["hono"], priority: 3 },

  // Desktop
  { framework: "electron", packages: ["electron"], priority: 6 },
];

/**
 * Source patterns by framework
 */
const SOURCE_PATTERNS: Record<DetectedFramework, string[]> = {
  nextjs: [
    "app/**/*.{ts,tsx,js,jsx}",
    "pages/**/*.{ts,tsx,js,jsx}",
    "src/**/*.{ts,tsx,js,jsx}",
    "components/**/*.{ts,tsx,js,jsx}",
    "lib/**/*.{ts,tsx,js,jsx}",
  ],
  remix: [
    "app/**/*.{ts,tsx,js,jsx}",
    "routes/**/*.{ts,tsx,js,jsx}",
  ],
  react: [
    "src/**/*.{ts,tsx,js,jsx}",
    "components/**/*.{ts,tsx,js,jsx}",
    "lib/**/*.{ts,tsx,js,jsx}",
  ],
  vue: [
    "src/**/*.{ts,js,vue}",
    "components/**/*.{ts,js,vue}",
  ],
  angular: [
    "src/**/*.{ts,js}",
  ],
  svelte: [
    "src/**/*.{ts,js,svelte}",
  ],
  astro: [
    "src/**/*.{ts,tsx,js,jsx,astro}",
  ],
  nuxt: [
    "pages/**/*.{ts,js,vue}",
    "components/**/*.{ts,js,vue}",
    "composables/**/*.{ts,js}",
    "server/**/*.{ts,js}",
  ],
  nestjs: [
    "src/**/*.{ts,js}",
  ],
  express: [
    "src/**/*.{ts,js}",
    "routes/**/*.{ts,js}",
    "controllers/**/*.{ts,js}",
    "middleware/**/*.{ts,js}",
  ],
  fastify: [
    "src/**/*.{ts,js}",
    "routes/**/*.{ts,js}",
    "plugins/**/*.{ts,js}",
  ],
  koa: [
    "src/**/*.{ts,js}",
    "routes/**/*.{ts,js}",
  ],
  hono: [
    "src/**/*.{ts,js}",
  ],
  electron: [
    "src/**/*.{ts,tsx,js,jsx}",
    "main/**/*.{ts,js}",
    "renderer/**/*.{ts,tsx,js,jsx}",
  ],
  unknown: [
    "src/**/*.{ts,tsx,js,jsx}",
    "lib/**/*.{ts,tsx,js,jsx}",
    "**/*.{ts,tsx,js,jsx}",
  ],
};

/**
 * Default ignore patterns
 */
const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.git/**",
  "**/vendor/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.d.ts",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/*.test.{ts,tsx,js,jsx}",
  "**/*.spec.{ts,tsx,js,jsx}",
  "**/test/**",
  "**/tests/**",
];

// =============================================================================
// Project Detector Class
// =============================================================================

/**
 * Detects project configuration from the file system.
 *
 * @example
 * ```typescript
 * const detector = new ProjectDetector('/path/to/project');
 * const project = await detector.detect();
 *
 * console.log(project.framework);     // 'nextjs'
 * console.log(project.language);      // 'typescript'
 * console.log(project.sourcePatterns); // ['app/**\/*.tsx', ...]
 * ```
 */
export class ProjectDetector {
  constructor(private rootPath: string) {}

  /**
   * Detects the project configuration.
   */
  async detect(): Promise<DetectedProject> {
    const packageJson = await this.readPackageJson();
    const hasTypeScript = await this.detectTypeScript();
    const tsconfigPath = hasTypeScript ? await this.findTsConfig() : null;
    const framework = this.detectFramework(packageJson);
    const projectType = this.detectProjectType(packageJson, framework);
    const packageManager = await this.detectPackageManager();
    const { isMonorepo, workspaces } = this.detectMonorepo(packageJson);

    return {
      rootPath: this.rootPath,
      name: packageJson?.name ?? path.basename(this.rootPath),
      version: packageJson?.version ?? "0.0.0",
      framework,
      language: this.detectLanguage(hasTypeScript, packageJson),
      projectType,
      hasTypeScript,
      tsconfigPath,
      sourcePatterns: this.getSourcePatterns(framework, projectType),
      ignorePatterns: this.getIgnorePatterns(framework),
      entryPoints: this.detectEntryPoints(packageJson),
      packageManager,
      isMonorepo,
      workspaces,
    };
  }

  /**
   * Reads and parses package.json
   */
  private async readPackageJson(): Promise<PackageJson | null> {
    const packagePath = path.join(this.rootPath, "package.json");

    if (!(await fileExists(packagePath))) {
      return null;
    }

    try {
      const content = await fs.readFile(packagePath, "utf-8");
      return JSON.parse(content) as PackageJson;
    } catch {
      return null;
    }
  }

  /**
   * Detects if TypeScript is used
   */
  private async detectTypeScript(): Promise<boolean> {
    // Check for tsconfig.json
    const tsconfigPath = path.join(this.rootPath, "tsconfig.json");
    if (await fileExists(tsconfigPath)) {
      return true;
    }

    // Check for TypeScript in dependencies
    const packageJson = await this.readPackageJson();
    if (packageJson) {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      return "typescript" in allDeps;
    }

    return false;
  }

  /**
   * Finds the tsconfig.json path
   */
  private async findTsConfig(): Promise<string | null> {
    const possiblePaths = [
      path.join(this.rootPath, "tsconfig.json"),
      path.join(this.rootPath, "tsconfig.app.json"),
      path.join(this.rootPath, "tsconfig.build.json"),
    ];

    for (const configPath of possiblePaths) {
      if (await fileExists(configPath)) {
        return configPath;
      }
    }

    return null;
  }

  /**
   * Detects the framework from package.json dependencies
   */
  private detectFramework(packageJson: PackageJson | null): DetectedFramework {
    if (!packageJson) {
      return "unknown";
    }

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    // Sort by priority (highest first) and find matching framework
    const sortedRules = [...FRAMEWORK_DETECTION].sort(
      (a, b) => b.priority - a.priority
    );

    for (const rule of sortedRules) {
      if (rule.packages.some((pkg) => pkg in allDeps)) {
        return rule.framework;
      }
    }

    return "unknown";
  }

  /**
   * Detects the project type
   */
  private detectProjectType(
    packageJson: PackageJson | null,
    framework: DetectedFramework
  ): ProjectType {
    if (!packageJson) {
      return "unknown";
    }

    // Check for monorepo
    if (packageJson.workspaces) {
      return "monorepo";
    }

    // Check for CLI
    if (packageJson.bin) {
      return "cli";
    }

    // Check by framework
    switch (framework) {
      case "nextjs":
      case "remix":
      case "nuxt":
      case "astro":
        return "fullstack";

      case "react":
      case "vue":
      case "angular":
      case "svelte":
        return "frontend";

      case "express":
      case "fastify":
      case "koa":
      case "hono":
      case "nestjs":
        return "backend";

      case "electron":
        return "fullstack";

      default:
        // Check if it's a library (has main/module/types)
        if (packageJson.main || packageJson.module || packageJson.types) {
          return "library";
        }
        return "unknown";
    }
  }

  /**
   * Detects the primary language
   */
  private detectLanguage(
    hasTypeScript: boolean,
    packageJson: PackageJson | null
  ): DetectedLanguage {
    if (!hasTypeScript) {
      return "javascript";
    }

    // Check if there's significant JS usage
    const scripts = packageJson?.scripts ?? {};
    const hasJsScripts = Object.values(scripts).some(
      (script) => script.includes(".js") && !script.includes(".jsx")
    );

    if (hasJsScripts) {
      return "mixed";
    }

    return "typescript";
  }

  /**
   * Gets source patterns for the detected framework
   */
  private getSourcePatterns(
    framework: DetectedFramework,
    projectType: ProjectType
  ): string[] {
    const patterns = [...SOURCE_PATTERNS[framework]];

    // Add common patterns based on project type
    if (projectType === "library") {
      patterns.push("lib/**/*.{ts,tsx,js,jsx}");
    }

    if (projectType === "cli") {
      patterns.push("bin/**/*.{ts,js}");
      patterns.push("commands/**/*.{ts,js}");
    }

    // Deduplicate
    return [...new Set(patterns)];
  }

  /**
   * Gets ignore patterns
   */
  private getIgnorePatterns(framework: DetectedFramework): string[] {
    const patterns = [...DEFAULT_IGNORE_PATTERNS];

    // Add framework-specific ignores
    switch (framework) {
      case "nextjs":
        patterns.push("**/.vercel/**");
        break;
      case "nuxt":
        patterns.push("**/.output/**");
        break;
      case "astro":
        patterns.push("**/.astro/**");
        break;
    }

    return patterns;
  }

  /**
   * Detects entry points from package.json
   */
  private detectEntryPoints(packageJson: PackageJson | null): string[] {
    if (!packageJson) {
      return [];
    }

    const entryPoints: string[] = [];

    if (packageJson.main) {
      entryPoints.push(packageJson.main);
    }

    if (packageJson.module) {
      entryPoints.push(packageJson.module);
    }

    if (typeof packageJson.bin === "string") {
      entryPoints.push(packageJson.bin);
    } else if (packageJson.bin) {
      entryPoints.push(...Object.values(packageJson.bin));
    }

    return entryPoints;
  }

  /**
   * Detects the package manager
   */
  private async detectPackageManager(): Promise<
    "npm" | "yarn" | "pnpm" | "bun" | "unknown"
  > {
    // Check for lock files
    if (await fileExists(path.join(this.rootPath, "pnpm-lock.yaml"))) {
      return "pnpm";
    }
    if (await fileExists(path.join(this.rootPath, "yarn.lock"))) {
      return "yarn";
    }
    if (await fileExists(path.join(this.rootPath, "bun.lockb"))) {
      return "bun";
    }
    if (await fileExists(path.join(this.rootPath, "package-lock.json"))) {
      return "npm";
    }

    return "unknown";
  }

  /**
   * Detects if project is a monorepo
   */
  private detectMonorepo(packageJson: PackageJson | null): {
    isMonorepo: boolean;
    workspaces: string[];
  } {
    if (!packageJson?.workspaces) {
      return { isMonorepo: false, workspaces: [] };
    }

    const workspaces = Array.isArray(packageJson.workspaces)
      ? packageJson.workspaces
      : packageJson.workspaces.packages ?? [];

    return {
      isMonorepo: workspaces.length > 0,
      workspaces,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a ProjectDetector instance and detects project configuration.
 *
 * @param rootPath - Project root directory
 * @returns Detected project configuration
 */
export async function detectProject(rootPath: string): Promise<DetectedProject> {
  const detector = new ProjectDetector(rootPath);
  return detector.detect();
}

/**
 * Creates a new ProjectDetector instance.
 */
export function createProjectDetector(rootPath: string): ProjectDetector {
  return new ProjectDetector(rootPath);
}
