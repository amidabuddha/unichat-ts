import assert from "assert";
import { ApiHelper } from "./api/apiHelper";
import { ChatHelper } from "./api/chatHelper";
import { Role } from "./types";

function assertBaseURL(model: string, expectedBaseURL: string) {
  const helper = new ApiHelper({ apiKey: "test-key" });
  const client = helper.get_client(model);

  assert.equal(client.baseURL, expectedBaseURL);
  assert.equal(typeof client.chat?.completions?.create, "function");
}

async function assertOpenAICompatibleChatPath(model: string, helper = new ApiHelper({ apiKey: "test-key" })) {
  let capturedParams: any;
  const fakeClient = {
    chat: {
      completions: {
        create: async (params: any) => {
          capturedParams = params;
          return {
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 0,
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                logprobs: null,
                finish_reason: "stop"
              }
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2
            }
          };
        }
      }
    }
  };

  const chatHelper = new ChatHelper(
    helper,
    model,
    [
      { role: Role.System, content: "x" },
      { role: Role.User, content: "y" }
    ],
    1,
    [],
    false,
    false,
    false,
    fakeClient,
    "",
  );

  const response = await chatHelper.get_response();
  assert.equal(capturedParams.model, model);
  assert.equal(capturedParams.stream, false);
  assert.equal(response.choices[0].message.content, "ok");
}

async function testOpenAIModelDoesNotHitMissingProviderLists() {
  assertBaseURL("gpt-5.4-mini", "https://api.openai.com/v1");
  await assertOpenAICompatibleChatPath("gpt-5.4-mini");
}

async function testOpenAICompatibleProviderRoutes() {
  const xaiHelper = new ApiHelper({ apiKey: "test-key", baseURL: "https://api.x.ai/v1" });
  const googleHelper = new ApiHelper({
    apiKey: "test-key",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
  });

  assert.equal(xaiHelper.get_client("grok-4.3-latest").baseURL, "https://api.x.ai/v1");
  assert.equal(googleHelper.get_client("gemini-3.1-flash-lite-preview").baseURL, "https://generativelanguage.googleapis.com/v1beta/openai/");
  await assertOpenAICompatibleChatPath("grok-4.3-latest");
  await assertOpenAICompatibleChatPath("gemini-3.1-flash-lite-preview");

  const helper = new ApiHelper({ apiKey: "test-key", baseURL: "https://example.com/v1" });
  assert.equal(helper.get_client("gpt-5.4-mini").baseURL, "https://example.com/v1");
  assert.equal(helper.get_client("some-upstream-served-model").baseURL, "https://example.com/v1");
}

async function testMissingOptionalProviderGroupsDoNotCrash() {
  const helper = new ApiHelper({ apiKey: "test-key", baseURL: "https://example.com/v1" });
  delete helper.models.openai_models;
  delete helper.models.xai_models;
  delete helper.models.google_models;

  const client = helper.get_client("gpt-5.4-mini");
  assert.equal(client.baseURL, "https://example.com/v1");
  await assertOpenAICompatibleChatPath("gpt-5.4-mini", helper);
}

function testOpenAIModelSystemRoleBecomesDeveloper() {
  const helper = new ApiHelper({ apiKey: "test-key" });
  const conversation = [
    { role: Role.System, content: "format carefully" },
    { role: Role.User, content: "hello" },
  ];

  const { conversation: normalized } = helper.set_defaults("gpt-5.4-mini", conversation);

  assert.equal(normalized[0].role, "developer");
  assert.equal(normalized[0].content, "Formatting re-enabled\nformat carefully");
}

async function testAnthropicModelSyncAndRequestShape() {
  const helper = new ApiHelper({ apiKey: "test-key" });
  let capturedParams: any;
  const fakeClient = {
    messages: {
      create: async (params: any) => {
        capturedParams = params;
        return { id: "msg-test" };
      }
    }
  };

  assert.equal(helper.has_model("anthropic_models", "claude-sonnet-5"), true);
  assert.equal(helper.has_model("anthropic_models", "claude-opus-4-8"), true);
  assert.equal(helper.has_model("anthropic_models", "claude-opus-4-7"), false);
  assert.equal(helper.get_max_tokens("claude-sonnet-5"), 128000);
  assert.equal(helper.get_max_tokens("claude-opus-4-8"), 128000);

  const chatHelper = new ChatHelper(
    helper,
    "claude-sonnet-5",
    [{ role: Role.User, content: "hello" }],
    0.2,
    [],
    false,
    false,
    "high",
    fakeClient,
    "",
  );

  await chatHelper.get_response();
  assert.equal("temperature" in capturedParams, false);
  assert.deepEqual(capturedParams.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(capturedParams.output_config, { effort: "high" });
}

function testAnthropicThinkingAndRedactedBlocks() {
  const helper = new ApiHelper({ apiKey: "test-key" });
  const response: any = {
    id: "msg-test",
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "reasoning", signature: "sig" },
      { type: "redacted_thinking", data: "opaque" },
      { type: "text", text: "answer" },
    ],
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 2,
    },
  };

  assert.deepEqual(helper.blockToDict(response.content[1]), {
    type: "redacted_thinking",
    data: "opaque",
  });

  const converted = helper.convertClaudeToGPT(response);
  assert.equal(converted.choices[0].message.content, "answer");
  assert.equal(converted.choices[0].message.reasoning_content, "reasoning");
  assert.equal(converted.choices[0].finish_reason, "stop");
}

function testCacheMessagesPreservesMultiBlockContent() {
  const helper = new ApiHelper({ apiKey: "test-key" });
  const cached = helper.cacheMessages([
    {
      role: Role.User,
      content: [
        { type: "text", text: "first" },
        { type: "tool_result", tool_use_id: "tool-1", content: "result" },
      ],
    },
  ]);

  assert.equal(Array.isArray(cached[0].content), true);
  const content = cached[0].content as any[];
  assert.equal(content.length, 2);
  assert.equal(content[0].cache_control, undefined);
  assert.deepEqual(content[1].cache_control, { type: "ephemeral" });
}

async function main() {
  await testOpenAIModelDoesNotHitMissingProviderLists();
  await testOpenAICompatibleProviderRoutes();
  await testMissingOptionalProviderGroupsDoNotCrash();
  testOpenAIModelSystemRoleBecomesDeveloper();
  await testAnthropicModelSyncAndRequestShape();
  testAnthropicThinkingAndRedactedBlocks();
  testCacheMessagesPreservesMultiBlockContent();
  console.log("Regression tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
