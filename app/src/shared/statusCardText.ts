/** Keep explicit monetary wording out of canvas text while the display policy hides amounts. */
export function redactCardMoney(value: string): string {
  return value.replace(/\bUSD\b(?:\s*\d[\d,]*(?:\.\d+)?)?|(?:US)?\$\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:USD|dollars?|cents?)\b/gi, '[amount hidden]');
}
