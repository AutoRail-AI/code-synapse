
import { CozoGraphStore } from "../../graph/cozo-graph-store.js";
import path from "path";

async function verifyHashes() {
    // Path to the default database location
    const dbPath = path.resolve(process.cwd(), ".code-synapse/data/cozodb");
    console.log(`Checking DB at ${dbPath}`);

    const store = new CozoGraphStore({ path: dbPath });

    try {
        console.log("Opening database...");
        await store.initialize();

        // Query stats about file hashes
        const result = await store.query(`
      ?[count, empty_count, valid_count] := *justification{file_hash},
      count = count(file_hash),
      empty_count = count_if(file_hash = ""),
      valid_count = count - empty_count
    `);

        if (result.rows.length > 0) {
            const { count, empty_count, valid_count } = result.rows[0] as any;
            console.log("\n--- Verification Results ---");
            console.log(`Total Justifications: ${count}`);
            console.log(`✅ Valid Hashes:       ${valid_count}`);
            console.log(`⚠️ Empty Hashes:       ${empty_count}`);

            if (valid_count > 0 && empty_count === 0) {
                console.log("\nSUCCESS: All justifications have valid hashes.");
            } else if (valid_count > 0) {
                console.log("\nPARTIAL SUCCESS: Some hashes are stored, but some are still empty.");
            } else {
                console.log("\nFAILURE: No valid hashes found.");
            }
        }

        // Show a few samples
        console.log("\n--- Sample Hashes ---");
        const samples = await store.query(`
      ?[id, name, file_hash] := *justification{id, name, file_hash}
      :limit 5
    `);

        samples.rows.forEach((row: any) => {
            console.log(`Entity: ${row.name} | Hash: ${row.file_hash ? row.file_hash.substring(0, 10) + "..." : "[EMPTY]"}`);
        });

    } catch (error: any) {
        if (error.message.includes("lock")) {
            console.error("\n❌ Database is LOCKED. Please stop the running 'code-synapse' process and try again.");
        } else {
            console.error("\n❌ Error:", error.message);
        }
    } finally {
        try {
            await store.close();
        } catch { }
    }
}

verifyHashes();
