/**
 * MRR (Mean Reciprocal Rank) Evaluation for Hybrid Search
 *
 * Runs golden queries against a pre-indexed codebase and computes MRR.
 * Skipped by default — requires a running indexed project.
 *
 * To run:
 *   1. Index a codebase: `pnpm build && node dist/cli/index.js`
 *   2. Remove the `.skip` below
 *   3. Run: `pnpm test src/core/search/__tests__/evaluation/evaluate-mrr.ts`
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface GoldenQuery {
  id: number;
  query: string;
  intent: string;
  expectedFiles: string[];
}

interface GoldenQueryFile {
  description: string;
  queries: GoldenQuery[];
}

/**
 * Compute reciprocal rank: 1/rank of the first expected file found in results.
 * Returns 0 if no expected file is found.
 */
function reciprocalRank(resultFiles: string[], expectedFiles: string[]): number {
  if (expectedFiles.length === 0) return 1; // No expectation = perfect score
  for (let i = 0; i < resultFiles.length; i++) {
    const resultFile = resultFiles[i]!.toLowerCase();
    for (const expected of expectedFiles) {
      if (resultFile.includes(expected.toLowerCase()) || expected.toLowerCase().includes(resultFile)) {
        return 1 / (i + 1);
      }
    }
  }
  return 0;
}

describe.skip("Hybrid Search MRR Evaluation", () => {
  it("should compute MRR across golden queries", async () => {
    // Load golden queries
    const goldenPath = path.join(__dirname, "golden-queries.json");
    const goldenData: GoldenQueryFile = JSON.parse(
      fs.readFileSync(goldenPath, "utf-8")
    );

    // This test requires a running HybridSearchService with an indexed codebase.
    // For CI/integration, you'd wire up the actual service here.
    // For now, this is a placeholder showing the evaluation structure.

    const mockResults: Record<number, string[]> = {};

    // In a real run, you'd do:
    // const service = await createHybridSearchServiceForProject(projectPath);
    // for (const gq of goldenData.queries) {
    //   const results = await service.searchWithJustification(gq.query);
    //   mockResults[gq.id] = results.map(r => r.filePath);
    // }

    let totalRR = 0;
    let queryCount = 0;
    const perQueryResults: Array<{
      id: number;
      query: string;
      intent: string;
      rr: number;
      topResult?: string;
    }> = [];

    for (const gq of goldenData.queries) {
      const resultFiles = mockResults[gq.id] ?? [];
      const rr = reciprocalRank(resultFiles, gq.expectedFiles);
      totalRR += rr;
      queryCount++;

      perQueryResults.push({
        id: gq.id,
        query: gq.query,
        intent: gq.intent,
        rr,
        topResult: resultFiles[0],
      });
    }

    const mrr = queryCount > 0 ? totalRR / queryCount : 0;

    // Print results table
    console.log("\n=== Hybrid Search MRR Evaluation ===\n");
    console.log("| ID | Query | Intent | RR | Top Result |");
    console.log("|----|-------|--------|----|------------|");
    for (const r of perQueryResults) {
      console.log(
        `| ${r.id} | ${r.query.slice(0, 30).padEnd(30)} | ${r.intent.padEnd(12)} | ${r.rr.toFixed(2)} | ${(r.topResult ?? "N/A").slice(0, 40)} |`
      );
    }
    console.log(`\nMRR: ${mrr.toFixed(4)}`);
    console.log(`Queries: ${queryCount}`);

    // When running against a real indexed codebase, set a target MRR
    // expect(mrr).toBeGreaterThan(0.5);
    expect(goldenData.queries.length).toBe(20);
  });
});
