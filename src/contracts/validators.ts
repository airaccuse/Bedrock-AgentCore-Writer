import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const Ajv2020: typeof import("ajv/dist/2020.js").default = require("ajv/dist/2020").default;
const addFormats: typeof import("ajv-formats").default = require("ajv-formats").default;

export function validateSchemaFiles(schemaDir: string): { ok: boolean; errors: string[] } {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);

  const errors: string[] = [];
  const files = fs.readdirSync(schemaDir).filter((name) => name.endsWith(".schema.json"));

  for (const file of files) {
    const fullPath = path.join(schemaDir, file);
    const raw = fs.readFileSync(fullPath, "utf8");
    const schema = JSON.parse(raw);
    const valid = ajv.validateSchema(schema);
    if (!valid) {
      const msg = ajv.errorsText(ajv.errors, { separator: " | " });
      errors.push(`${file}: ${msg}`);
    }
  }

  return { ok: errors.length === 0, errors };
}