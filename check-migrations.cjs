async function main() {
  const migrations = await prisma.$queryRaw`
    SELECT migration_name, started_at, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    ORDER BY started_at
  `;

  console.table(migrations);
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
