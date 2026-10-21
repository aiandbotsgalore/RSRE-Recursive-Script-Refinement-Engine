/**
 * Safe JSON fetch utility that prevents "Unexpected token '<', \"<!doctype \"... is not valid JSON"
 * when a reverse proxy, gateway timeout (502/504), or SPA fallback returns an HTML page instead of JSON.
 */

export function sanitizeApiErrorMessage(
  err: unknown,
  fallback = "Our AI writing assistant is momentarily busy. Your script is safe—please try again."
): string {
  if (err instanceof Error) {
    const msg = err.message || "";
    const lower = msg.toLowerCase();
    if (
      lower.includes("<!doctype") ||
      lower.includes("<html") ||
      lower.includes("unexpected token") ||
      lower.includes("not valid json") ||
      lower.includes("json.parse") ||
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("load failed") ||
      msg.includes("{") ||
      lower.includes("status") ||
      lower.includes("429") ||
      lower.includes("500") ||
      lower.includes("502") ||
      lower.includes("503") ||
      lower.includes("504") ||
      lower.includes("404")
    ) {
      return fallback;
    }
    return msg;
  }
  return fallback;
}

export function extractJsonFromText<T>(rawText: string): T {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Empty response from server.");
  }

  // Detect HTML responses (<!doctype html>, <html>, etc.) from proxy/gateway pages
  if (trimmed.startsWith("<")) {
    throw new Error("HTML_RESPONSE_RECEIVED");
  }

  // Strip markdown code fences if present
  const unfenced = trimmed.startsWith("```")
    ? trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim()
    : trimmed;

  try {
    return JSON.parse(unfenced) as T;
  } catch {
    // Attempt to locate outermost JSON object if surrounded by extra text
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error("INVALID_JSON_RESPONSE");
  }
}

export async function safeFetchJson<T>(
  url: string,
  init: RequestInit,
  options?: {
    retries?: number;
    fallbackOnHtmlOrNetworkError?: () => T | Promise<T>;
  }
): Promise<T> {
  const maxRetries = options?.retries ?? 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });

      const rawText = await response.text();

      if (!response.ok) {
        // Try to parse structured JSON error if present
        try {
          const parsedErr = extractJsonFromText<{ error?: string }>(rawText);
          if (parsedErr && typeof parsedErr.error === "string") {
            throw new Error(sanitizeApiErrorMessage(new Error(parsedErr.error)));
          }
        } catch (innerErr) {
          if (
            innerErr instanceof Error &&
            innerErr.message !== "HTML_RESPONSE_RECEIVED" &&
            innerErr.message !== "INVALID_JSON_RESPONSE"
          ) {
            throw innerErr;
          }
        }
        throw new Error(`HTTP_${response.status}`);
      }

      return extractJsonFromText<T>(rawText);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      lastError = err;

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }

  if (options?.fallbackOnHtmlOrNetworkError) {
    return await options.fallbackOnHtmlOrNetworkError();
  }

  throw new Error(sanitizeApiErrorMessage(lastError));
}
