import { PrismaClient } from "@prisma/client";
import process from "process";

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  { name: "Finanzas", color: "#2E7D32" },
  { name: "Trabajo", color: "#1565C0" },
  { name: "Salud", color: "#C62828" },
  { name: "Hogar", color: "#EF6C00" },
  { name: "Personal", color: "#6A1B9A" },
  { name: "Otros", color: "#616161" },
];

async function main() {
  for (const category of DEFAULT_CATEGORIES) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }
  console.log(`Seed completo: ${DEFAULT_CATEGORIES.length} categorías aseguradas.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
  