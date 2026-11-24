const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'users' AND column_name IN (
          'googleCalendarRefreshToken',
          'googleCalendarConnectedAt'
        ))
        OR
        (table_name = 'tasks' AND column_name = 'googleEventId')
      )
    ORDER BY table_name, column_name
  `;

  console.table(columns);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
