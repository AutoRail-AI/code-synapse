
import { createTypeScriptParser } from "../../parser/typescript-parser.js";

async function reproduce() {
  console.log("Starting UCE reproduction for Imports & Calls...");

  // 1. Initialize Parser
  const parser = createTypeScriptParser();
  await parser.initialize();
  console.log("Parser initialized");

  const code = `
    import { something } from "./other-module";
    import * as fs from "node:fs";

    function myArray() {
      something();
      return [1, 2, 3];
    }
  `;

  // 2. Parse code
  console.log("Parsing TypeScript code...");
  const uceFile = await parser.parseCode(code, "typescript");

  console.log("UCE Imports:", uceFile.imports.length);
  console.log("Imports details:", JSON.stringify(uceFile.imports, null, 2));

  if (uceFile.imports.length === 2) {
    console.log("SUCCESS: Imports extracted correctly via generic lookup.");
  } else {
    console.error(`FAIL: Expected 2 imports, got ${uceFile.imports.length}`);
  }

  await parser.close();
}

reproduce().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
