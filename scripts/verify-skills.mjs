import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ajv } from "ajv";
const catalog = JSON.parse(readFileSync(".agents/skills/catalog.json", "utf8"));
for (const skill of catalog.skills) {
  const dir = ".agents/skills/" + skill.id;
  const md = readFileSync(dir + "/SKILL.md");
  const schema = readFileSync(skill.schema);
  const copy = readFileSync(dir + "/references/output.schema.json");
  if (!schema.equals(copy)) throw Error("SCHEMA_DRIFT:" + skill.id);
  if (
    createHash("sha256").update(md).update(schema).digest("hex") !==
    skill.sha256
  )
    throw Error("SKILL_HASH_CHANGED:" + skill.id);
  new Ajv({ strict: true }).compile(JSON.parse(schema));
  if (!md.toString().startsWith("---\nname: " + skill.id + "\n"))
    throw Error("INVALID_FRONTMATTER");
}
console.log(
  catalog.skills.length +
    " skills: hashes, schemas e referências válidos; qualidade de IA ainda não avaliada.",
);
