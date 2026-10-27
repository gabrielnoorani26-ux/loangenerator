/**
 * Downloads the local background-segmentation model so later runs work offline:
 *   npm run models            → the model selected by LOCAL_MODEL (default isnet)
 *   npm run models -- u2netp  → a specific model
 *   npm run models -- all     → every model
 */
import "dotenv/config";
import { ensureModel, MODELS, modelPath, modelSpec } from "../lib/local/models";

async function main() {
  const arg = process.argv[2];
  const specs = arg === "all" ? Object.values(MODELS) : [modelSpec(arg || undefined)];
  for (const spec of specs) {
    await ensureModel(spec);
    console.log(`✓ ${spec.name}: ${modelPath(spec)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
