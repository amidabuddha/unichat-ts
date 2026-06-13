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

async function main() {
  await testOpenAIModelDoesNotHitMissingProviderLists();
  await testOpenAICompatibleProviderRoutes();
  await testMissingOptionalProviderGroupsDoNotCrash();
  console.log("Regression tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
