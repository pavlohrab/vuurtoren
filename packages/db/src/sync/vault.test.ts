/** A vault started without a passphrase (a computer setting up sync for its own phone, SY1). */
import { describe, expect, it } from "vitest";
import { LIGHT_ARGON2 } from "../testing.js";
import { WrongPassphraseError, changePassphrase, createVault, unlockVault } from "./crypto.js";

describe("a vault without a passphrase", () => {
  it("is locked by the recovery key only, and a passphrase can be added later", async () => {
    const { vault, key, recoveryKey } = await createVault(null, LIGHT_ARGON2);
    expect(vault.locks.map((l) => l.kind)).toEqual(["recovery"]);
    expect((await unlockVault(vault, recoveryKey)).raw).toEqual(key.raw);
    await expect(unlockVault(vault, "lange zinnen lezen")).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    const withPass = await changePassphrase(vault, key, "lange zinnen lezen", LIGHT_ARGON2);
    expect(withPass.locks.map((l) => l.kind).sort()).toEqual(["passphrase", "recovery"]);
    expect((await unlockVault(withPass, "lange zinnen lezen")).raw).toEqual(key.raw);
    // The same vault id: devices keep their sync state.
    expect(withPass.id).toBe(vault.id);
  });
});
