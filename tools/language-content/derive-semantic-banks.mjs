import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { planDerivations } from "./lib/derive-semantic-bank-content.mjs";

const root = new URL("../../", import.meta.url).pathname;
const write = process.argv.includes("--write");
const plans = planDerivations(root);
const lines = plans.map(item => `${item.courseId}\t${item.game}\t${item.count}\t${item.relativePath}`);
console.log(lines.join("\n"));
console.log(`files ${plans.length} records ${plans.reduce((sum, item) => sum + item.count, 0)} mode ${write ? "write" : "check"}`);
if (!write) process.exit(0);
for (const item of plans) {
  writeFileSync(join(root, item.relativePath), `${JSON.stringify(item.document, null, 2)}\n`);
}
console.log("wrote derived content");
