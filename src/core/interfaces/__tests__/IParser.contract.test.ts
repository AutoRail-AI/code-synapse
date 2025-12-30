/**
 * IParser Contract Tests
 *
 * Verifies that any IParser implementation correctly fulfills the contract.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { IParser } from "../IParser.js";
import { TypeScriptParser } from "../../parser/typescript-parser.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("IParser Contract", () => {
  let parser: IParser;
  let tempDir: string;
  let testFilePath: string;

  beforeAll(async () => {
    parser = new TypeScriptParser();
    await parser.initialize();

    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "iparser-test-"));

    // Create a test TypeScript file
    testFilePath = path.join(tempDir, "test.ts");
    await fs.writeFile(
      testFilePath,
      `
// Test file for IParser contract
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export class Greeter {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet(): string {
    return \`Hello, \${this.name}!\`;
  }
}

export interface Person {
  name: string;
  age: number;
}

export type GreetFunction = (name: string) => string;
`.trim()
    );
  });

  afterAll(async () => {
    await parser.close();
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Lifecycle", () => {
    it("should report isReady as true after initialization", () => {
      expect(parser.isReady).toBe(true);
    });
  });

  describe("parseFile", () => {
    it("should parse a file from disk and return UCEFile", async () => {
      const uce = await parser.parseFile(testFilePath);

      expect(uce).toBeDefined();
      expect(uce.filePath).toBe(testFilePath);
      expect(uce.language).toBe("typescript");
    });

    it("should extract functions from the file", async () => {
      const uce = await parser.parseFile(testFilePath);

      expect(uce.functions).toHaveLength(1);
      expect(uce.functions[0]?.name).toBe("greet");
      expect(uce.functions[0]?.signature).toContain("name: string");
    });

    it("should extract classes from the file", async () => {
      const uce = await parser.parseFile(testFilePath);

      expect(uce.classes).toHaveLength(1);
      expect(uce.classes[0]?.name).toBe("Greeter");
      expect(uce.classes[0]?.methods).toBeDefined();
    });

    it("should extract interfaces from the file", async () => {
      const uce = await parser.parseFile(testFilePath);

      expect(uce.interfaces).toHaveLength(1);
      expect(uce.interfaces[0]?.name).toBe("Person");
    });

    it("should extract type aliases from the file", async () => {
      const uce = await parser.parseFile(testFilePath);

      expect(uce.typeAliases).toHaveLength(1);
      expect(uce.typeAliases[0]?.name).toBe("GreetFunction");
    });

    it("should throw error for non-existent file", async () => {
      await expect(
        parser.parseFile("/non/existent/file.ts")
      ).rejects.toThrow();
    });
  });

  describe("parseCode", () => {
    it("should parse source code string", async () => {
      const code = `export function hello(): void { console.log("hello"); }`;
      const uce = await parser.parseCode(code, "typescript");

      expect(uce).toBeDefined();
      expect(uce.functions).toHaveLength(1);
      expect(uce.functions[0]?.name).toBe("hello");
    });

    it("should parse JavaScript code", async () => {
      const code = `function greet(name) { return "Hello, " + name; }`;
      const uce = await parser.parseCode(code, "javascript");

      expect(uce).toBeDefined();
      expect(uce.functions).toHaveLength(1);
      expect(uce.functions[0]?.name).toBe("greet");
    });

    it("should handle unknown language by defaulting to typescript", async () => {
      const code = `const x: number = 42;`;
      // Should not throw, should default to typescript
      const uce = await parser.parseCode(code, "unknown");

      expect(uce).toBeDefined();
    });
  });

  describe("getSupportedLanguages", () => {
    it("should return array of supported language identifiers", () => {
      const languages = parser.getSupportedLanguages();

      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(0);
      expect(languages).toContain("typescript");
      expect(languages).toContain("javascript");
    });
  });

  describe("supports", () => {
    it("should return true for supported file extensions", () => {
      expect(parser.supports("file.ts")).toBe(true);
      expect(parser.supports("file.tsx")).toBe(true);
      expect(parser.supports("file.js")).toBe(true);
      expect(parser.supports("file.jsx")).toBe(true);
    });

    it("should return false for unsupported file extensions", () => {
      expect(parser.supports("file.py")).toBe(false);
      expect(parser.supports("file.rs")).toBe(false);
      expect(parser.supports("file.go")).toBe(false);
    });
  });
});
