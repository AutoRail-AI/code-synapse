
import { CozoDb } from 'cozo-node';
import path from 'path';

async function main() {
    const dbPath = path.join(process.cwd(), '.code-synapse/data/cozodb');
    console.log(`Opening db at: ${dbPath}`);

    try {
        const db = new CozoDb('rocksdb', dbPath);
        const result = await db.run('?[id, path] := *file{id, relative_path: path} :limit 5');
        console.log('Files in DB:', JSON.stringify(result, null, 2));

        const allFiles = await db.run('?[id, path] := *file{id, relative_path: path}');
        const found = allFiles.rows.filter(row => row[1].includes('trivial-filter'));
        console.log('files matching "trivial-filter":', found);

        if (found.length > 0) {
            const fileId = found[0][0];
            const filePath = found[0][1];
            console.log(`Checking justifications for file: ${filePath} (${fileId})`);

            // Get functions in this file
            const functions = await db.run(`?[id, name] := *function{id, name, file_id: $fileId}`, { fileId });
            console.log('Functions:', functions.rows);

            // Check justifications for these functions
            const entityIds = functions.rows.map(r => r[0]);
            if (entityIds.length > 0) {
                // Check justification table columns (dynamic check if possible, or just select *)
                // We'll select specific fields we care about
                // Inspect columns
                try {
                    const cols = await db.run('::columns justification');
                    console.log('Columns:', cols);
                } catch (e) {
                    console.log('Could not get columns:', e.message);
                }

                // Check justification table columns (select *) based on columns if possible, 
                // but for now let's try to just select * with wildcard if Cozo supports it, or explicit columns
                // We'll try accessin dependent_count and dependency_risk assuming they exist.
                const query = `
                    ?[entity_id, dependent_count, dependency_risk] := 
                    *justification{entity_id, dependent_count, dependency_risk},
                    entity_id in $entityIds
                `;
                try {
                    const justifications = await db.run(query, { entityIds });
                    console.log('Justifications (Metrics):', JSON.stringify(justifications, null, 2));
                } catch (e) {
                    console.log("Error querying metrics fields:", e.message);
                }
            }
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

main();
