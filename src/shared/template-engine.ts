import { ALLOWED_TEMPLATE_TOKENS } from "./templates";
import type { TemplateValidationResult } from "./types";

const TOKEN_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;

export function extractTemplateTokens(templateText: string): string[] {
  const found = new Set<string>();
  for (const match of templateText.matchAll(TOKEN_PATTERN)) {
    found.add(match[1]);
  }

  return [...found];
}

export function validateTemplate(templateText: string): TemplateValidationResult {
  const unknownTokens = extractTemplateTokens(templateText).filter((token) => !ALLOWED_TEMPLATE_TOKENS.has(token));
  return {
    isValid: unknownTokens.length === 0,
    unknownTokens
  };
}

function lookupValue(source: unknown, token: string): unknown {
  return token.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return "";
  }, source);
}

export function renderTemplate(templateText: string, values: Record<string, unknown>): string {
  const rendered = templateText.replace(TOKEN_PATTERN, (_, token: string) => {
    const value = lookupValue(values, token);
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  });

  return rendered
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
