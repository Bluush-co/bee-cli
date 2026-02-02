import * as QRCode from "qrcode";

export async function renderQrCode(value: string): Promise<string> {
  return await QRCode.toString(value, { type: "terminal", small: true });
}
