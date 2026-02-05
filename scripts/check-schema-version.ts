
import { createGraphStore } from "../src/core/graph/index.js";
import { getProjectRoot, getGraphDbPath } from "../src/utils/index.js";

async function main() {
    const projectRoot = getProjectRoot();
    const dbPath = getGraphDbPath(projectRoot);

    console.log(`Checking DB at: ${dbPath}`);

    const store = await createGraphStore({
        path: dbPath,
        engine: "rocksdb",
        runMigrations: false, // Don't run migrations, just inspect
    });

    await store.initialize();

    try {
        const version = await store.getSchemaVersion();
        console.log(`Current Schema Version in DB: ${version}`);

        // Check Columns
        try {
            const result = await store.query("::columns justification");
            console.log("Justification Table Columns:");
            console.table(result.rows);
        } catch (e) {
            console.log("Could not query columns:", e.message);
        }

    } catch (error) {
        console.error("Error inspecting DB:", error);
    } finally {
        await store.close();
    }
}

main().catch(console.error);
