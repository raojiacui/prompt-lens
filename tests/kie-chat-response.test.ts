import { describe, expect, it } from "vitest";
import { parseKieChatResponse, summarizeKieChatResponse } from "@/lib/ai/kie-chat-response";

describe("KIE chat response", () => {
  it("reads standard OpenAI-compatible content", () => {
    expect(parseKieChatResponse({
      choices: [{ message: { content: "analysis result" }, finish_reason: "stop" }],
    })).toBe("analysis result");
  });

  it("reads wrapped and segmented content", () => {
    expect(parseKieChatResponse({
      code: 200,
      data: {
        choices: [{ message: { content: [{ type: "text", text: "part one" }, { type: "text", text: " part two" }] } }],
      },
    })).toBe("part one part two");
  });

  it("reads a native Gemini response as a fallback", () => {
    expect(parseKieChatResponse({
      candidates: [{ content: { parts: [{ text: "native result" }] }, finishReason: "STOP" }],
    })).toBe("native result");
  });

  it("surfaces KIE business errors returned with HTTP 200", () => {
    expect(() => parseKieChatResponse({ code: 402, msg: "Insufficient credits" }))
      .toThrow("KIE API error (402): Insufficient credits");
  });

  it("keeps empty-response logs diagnostic but content-free", () => {
    const response = {
      choices: [{ message: { content: "secret model output" }, finish_reason: "length" }],
    };

    expect(summarizeKieChatResponse(response)).toEqual({
      responseType: "object",
      code: null,
      message: null,
      choiceCount: 1,
      candidateCount: 0,
      finishReason: "length",
      contentType: "string",
    });
    expect(JSON.stringify(summarizeKieChatResponse(response))).not.toContain("secret model output");
  });
});
