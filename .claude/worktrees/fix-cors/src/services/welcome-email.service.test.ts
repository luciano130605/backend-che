import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  update: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../config/prisma", () => ({
  prisma: { user: { updateMany: mocks.updateMany, update: mocks.update } },
}));
vi.mock("./email.service", () => ({ sendEmail: mocks.sendEmail }));

import { sendWelcomeEmailOnce, welcomeEmail } from "./welcome-email.service";

const user = { id: "u1", email: "luciano@mail.com", name: "Luciano Perez" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("welcomeEmail", () => {
  it("saluda por el primer nombre y escapa el HTML", () => {
    expect(welcomeEmail("Luciano Perez").text).toContain("¡Hola Luciano!");
    expect(welcomeEmail("<b>x</b>").html).not.toContain("<b>x</b>");
    expect(welcomeEmail(null).text).toContain("¡Hola!");
  });
});

describe("sendWelcomeEmailOnce", () => {
  it("manda el mail la primera vez", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    await sendWelcomeEmailOnce(user);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0][0]).toBe("luciano@mail.com");
  });

  it("no lo repite si ya se mandó", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await sendWelcomeEmailOnce(user);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("libera la reserva si el envío falla y no lanza error", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.sendEmail.mockRejectedValue(new Error("SES caído"));
    await expect(sendWelcomeEmailOnce(user)).resolves.toBeUndefined();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { welcomeEmailSentAt: null } });
  });
});
