export const SMS_ACKNOWLEDGEMENT = "K-SAR DEMO: Request recorded locally. No verified safe route is available. This simulator cannot dispatch help. Contact local emergency services.";

const BASIC = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const EXTENDED = new Set("\f^{}\\[~]|€");

// GSM 03.38 extension characters consume ESC plus one septet.
export function gsm7Septets(text: string): number | null {
  let count = 0;
  for (const character of text) {
    if (BASIC.has(character)) count++;
    else if (EXTENDED.has(character)) count += 2;
    else return null;
  }
  return count;
}

export type LocalSmsResult =
  | { accepted: true; kind: "FLOOD" | "DIALYSIS" | "TRAUMA"; location: string; reply: string; characters: 145; septets: 145; transmitted: false }
  | { accepted: false; error: string; transmitted: false };

export function simulateSms(input: string): LocalSmsResult {
  const text = input.trim();
  const septets = gsm7Septets(text);
  if (septets === null) return { accepted: false, error: "Use GSM-7 text without emoji or smart punctuation.", transmitted: false };
  if (septets > 145) return { accepted: false, error: "Keep the request within 145 GSM-7 septets.", transmitted: false };
  const match = /^(FLOOD|DIALYSIS|TRAUMA) +([^\r\n]+)$/i.exec(text);
  if (!match || !match[2].trim()) return { accepted: false, error: "Enter FLOOD, DIALYSIS or TRAUMA followed by a location.", transmitted: false };
  return { accepted: true, kind: match[1].toUpperCase() as "FLOOD" | "DIALYSIS" | "TRAUMA", location: match[2].trim(), reply: SMS_ACKNOWLEDGEMENT, characters: 145, septets: 145, transmitted: false };
}
