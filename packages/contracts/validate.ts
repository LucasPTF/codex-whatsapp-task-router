import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import type { Analysis } from "../core/model.ts";
import { DomainError } from "../core/model.ts";
const ajv = new Ajv({ allErrors: true, strict: true });
const schema = JSON.parse(
  readFileSync(
    new URL("../../schemas/conversation-analysis.schema.json", import.meta.url),
    "utf8",
  ),
);
const validate = ajv.compile<Analysis>(schema);
export function parseAnalysis(value: unknown): Analysis {
  if (!validate(value)) throw new DomainError("INVALID_ANALYSIS_SCHEMA", 400);
  return value;
}
