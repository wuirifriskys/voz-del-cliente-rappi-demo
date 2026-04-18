import Anthropic from "@anthropic-ai/sdk";
import { requireEnv } from "./env.ts";

export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
}

export const CLASSIFIER_MODEL = "claude-sonnet-4-6";
export const CLUSTERER_MODEL = "claude-sonnet-4-6";
