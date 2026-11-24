async function main() {
  const tables = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  console.table(tables);
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
