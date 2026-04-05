import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchemaFiles } from "../src/contracts/validators.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaDir = path.resolve(__dirname, "..", "schemas");
const result = validateSchemaFiles(schemaDir);

if (!result.ok) {
  console.error("Schema validation failed:");
  for (const err of result.errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log("All schemas are valid.");