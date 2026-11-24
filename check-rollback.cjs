const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`
    SELECT migration_name, logs, checksum, applied_steps_count
    FROM "_prisma_migrations"
    WHERE migration_name = '20261014170000_profile_preferences'
  `;

  console.dir(result, { depth: null });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
