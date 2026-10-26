import "dotenv/config";
import { prisma } from "../lib/db";
import { PRESET_SEEDS } from "../lib/preset-seeds";
import { EditSettingsSchema } from "../lib/settings";

async function main() {
  for (const seed of PRESET_SEEDS) {
    const settings = EditSettingsSchema.parse(seed.settings);
    await prisma.preset.upsert({
      where: { name: seed.name },
      update: {},
      create: {
        name: seed.name,
        description: seed.description,
        category: seed.category,
        settings,
        isDefault: Boolean(seed.isDefault),
      },
    });
  }
  const def = await prisma.preset.findFirst({ where: { isDefault: true } });
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      defaultPresetId: def?.id ?? null,
      maxConcurrentAiCalls: Number(process.env.MAX_CONCURRENT_AI_CALLS || 3),
      maxRetries: Number(process.env.MAX_RETRIES || 2),
    },
  });
  console.log(`Seeded ${PRESET_SEEDS.length} presets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
