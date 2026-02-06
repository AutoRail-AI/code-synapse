
import { ParserManager } from "../../parser/parser-manager.js";
import { ASTTransformer } from "../../parser/ast-transformer.js";

async function verifyJava() {
    console.log("Starting verification for Java Imports...");

    // 1. Initialize Manager & Transformer
    const parserManager = new ParserManager();
    await parserManager.initialize();
    const transformer = new ASTTransformer();

    console.log("ParserManager initialized");

    const code = `
    package com.example;

    import java.util.List;
    import com.example.service.UserService;
    import static org.junit.Assert.*;

    public class MyClass {
       private UserService userService;
    }
  `;

    // 2. Parse code
    console.log("Parsing Java code...");
    const parseResult = await parserManager.parseCode(code, "java");
    const grammarLanguage = parserManager.getLanguage("java");

    // 3. Transform
    const uceFile = transformer.transform(
        parseResult.tree,
        code,
        "MyClass.java",
        "java",
        grammarLanguage
    );

    console.log("UCE Imports:", uceFile.imports.length);
    console.log("Imports details:", JSON.stringify(uceFile.imports, null, 2));

    // Verify
    const imports = uceFile.imports;
    const expected = ["java.util.List", "com.example.service.UserService", "org.junit.Assert"];
    // Note: static import extraction might need specific handling, my current query is basic.
    // My query: (import_declaration (scoped_identifier) @import_name) @import

    // 'import java.util.List;' matches.
    // 'import com.example.service.UserService;' matches.
    // 'import static org.junit.Assert;' -> static imports might check against (import_declaration (static) ...) ?
    // Let's see what happens.

    if (imports.filter(i => i.source.includes("UserService")).length > 0) {
        console.log("SUCCESS: UserService import extracted.");
    } else {
        console.log("FAIL: UserService import NOT extracted.");
    }

    if (imports.filter(i => i.source.includes("List")).length > 0) {
        console.log("SUCCESS: List import extracted.");
    } else {
        console.log("FAIL: List import NOT extracted.");
    }

    await parserManager.close();
}

verifyJava().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
