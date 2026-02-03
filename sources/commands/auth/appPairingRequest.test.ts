import { describe, expect, it } from "bun:test";
import nacl from "tweetnacl";
import { requestAppPairing } from "./appPairingRequest";

const STAGING_APP_ID = "pk5z3uuzjpxj4f7frk6rsq2f";
const TIMEOUT_MS = 10_000;

describe("app pairing request", () => {
  it("creates or polls a staging request", async () => {
    const keyPair = nacl.box.keyPair();
    const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString("base64");

    const response = await requestAppPairing(
      "staging",
      STAGING_APP_ID,
      publicKeyBase64,
      AbortSignal.timeout(TIMEOUT_MS)
    );

    expect(["pending", "completed", "expired"]).toContain(response.status);
    expect(response.requestId.length).toBeGreaterThan(0);
  });
});
