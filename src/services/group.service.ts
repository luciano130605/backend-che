import { randomInt } from "node:crypto";
import { prisma } from "../config/prisma";

export class GroupError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "GroupError";
  }
}

export type GroupRole = "ADMIN" | "MEMBER";

// Lo que espera el front (Group en lib/api.ts).
export interface GroupDto {
  id: string;
  name: string;
  code: string;
  role: GroupRole;
  membersCount: number;
}

const CODE_PREFIX = "CHE-";
const CODE_LENGTH = 5;
// Sin 0/O ni 1/I: el código se dicta o se copia de un chat y esas letras se confunden.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CODE_ATTEMPTS = 5;

function generateCode() {
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${CODE_PREFIX}${suffix}`;
}

// Acepta "che-8x2k9", " CHE-8X2K9 " y también solo "8X2K9".
export function normalizeCode(input: string) {
  const code = input.trim().toUpperCase();
  return code.startsWith(CODE_PREFIX) ? code : `${CODE_PREFIX}${code}`;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function listMyGroups(userId: string): Promise<GroupDto[]> {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: { group: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "desc" },
  });

  return memberships.map((membership: any) => ({
    id: membership.group.id,
    name: membership.group.name,
    code: membership.group.code,
    role: membership.role,
    membersCount: membership.group._count.members,
  }));
}

export async function createGroup(userId: string, name: string): Promise<GroupDto> {
  // El código es único: si justo choca con otro, se genera uno nuevo.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    try {
      const group = await prisma.group.create({
        data: {
          name,
          code: generateCode(),
          members: { create: { userId, role: "ADMIN" } },
        },
      });
      return { id: group.id, name: group.name, code: group.code, role: "ADMIN", membersCount: 1 };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new GroupError("No pudimos generar un código de invitación. Probá de nuevo.", 500);
}

export async function joinGroup(userId: string, rawCode: string): Promise<GroupDto> {
  const group = await prisma.group.findUnique({ where: { code: normalizeCode(rawCode) } });
  if (!group) {
    throw new GroupError("No encontramos un grupo con ese código. Verificalo e intentá de nuevo.", 404);
  }

  const alreadyIn = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId } },
  });
  if (alreadyIn) throw new GroupError("Ya sos parte de este grupo.", 409);

  try {
    await prisma.groupMember.create({ data: { groupId: group.id, userId, role: "MEMBER" } });
  } catch (error) {
    // dos pedidos simultáneos del mismo usuario
    if (isUniqueViolation(error)) throw new GroupError("Ya sos parte de este grupo.", 409);
    throw error;
  }

  const membersCount = await prisma.groupMember.count({ where: { groupId: group.id } });
  return { id: group.id, name: group.name, code: group.code, role: "MEMBER", membersCount };
}
