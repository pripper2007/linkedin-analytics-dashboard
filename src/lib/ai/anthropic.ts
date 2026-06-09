// Shared Anthropic SDK client for server-side AI features.
//
// Why a shared module: future dashboard features will also call Claude
// (post classification, summary generation, etc.). Centralizing the
// client gives us one place to handle missing-key fallback, logging,
// and any future default options (base URL override, retry config).
//
// This module must only be imported from server code. Never import it
// from a 'use client' boundary — the SDK reads ANTHROPIC_API_KEY from
// process.env at instantiation.

import Anthropic from '@anthropic-ai/sdk';

let cachedClient: Anthropic | null = null;

/**
 * Returns an Anthropic client if ANTHROPIC_API_KEY is set, otherwise
 * null. Callers should treat a null return as "AI unavailable" and fall
 * back to a deterministic path — never throw or block the UI just
 * because the key isn't configured locally.
 *
 * The client is memoized per-process to avoid repeated construction in
 * hot paths. On Vercel's Fluid Compute runtime, instances are reused
 * across requests so the cached client survives between invocations.
 */
export function getAnthropic(): Anthropic | null {
  if (cachedClient) return cachedClient;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cachedClient;
}
