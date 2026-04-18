import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inputs: new Map<string, string>([
    ["github_token", "gh-token"],
    ["anthropic_api_key", "anthropic-token"],
    ["model", "claude-sonnet-4-20250514"],
    ["review_level", "standard"],
    ["ignore_patterns", "*.md,*.lock"],
    ["max_files", "20"],
    ["post_summary", "true"],
  ]),
  setSecret: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  getInput: vi.fn((name: string) => state.inputs.get(name) ?? ""),
  setSecret: state.setSecret,
}));

const { loadConfig } = await import("../src/config.js");

describe("loadConfig", () => {
  beforeEach(() => {
    state.inputs.set("github_token", "gh-token");
    state.inputs.set("anthropic_api_key", "anthropic-token");
    state.inputs.set("model", "claude-sonnet-4-20250514");
    state.inputs.set("review_level", "standard");
    state.inputs.set("ignore_patterns", "*.md,*.lock");
    state.inputs.set("max_files", "20");
    state.inputs.set("post_summary", "true");
    state.setSecret.mockReset();
  });

  it("parses and validates a valid configuration", () => {
    const config = loadConfig();

    expect(config.githubToken).toBe("gh-token");
    expect(config.anthropicApiKey).toBe("anthropic-token");
    expect(config.reviewLevel).toBe("standard");
    expect(config.ignorePatterns).toEqual(["*.md", "*.lock"]);
    expect(config.maxFiles).toBe(20);
    expect(config.postSummary).toBe(true);
    expect(state.setSecret).toHaveBeenCalledTimes(2);
  });

  it("throws for invalid review level", () => {
    state.inputs.set("review_level", "ultra");

    expect(() => loadConfig()).toThrow(/Invalid review_level/);
  });

  it("throws for invalid max_files", () => {
    state.inputs.set("max_files", "0");

    expect(() => loadConfig()).toThrow(/Invalid max_files/);
  });

  it("throws for invalid post_summary boolean", () => {
    state.inputs.set("post_summary", "sometimes");

    expect(() => loadConfig()).toThrow(/Invalid post_summary value/);
  });
});
