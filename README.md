# unichat
Universal API chat Node.js client for OpenAI, MistralAI, Anthropic, xAI, Google AI, DeepSeek and Alibaba.

## Build sequence:
```shell
rm -rf dist
```
```shell
npx tsc
```
```shell
npm publish
```

## Usage:

1.  Install the npm package:

    ```shell
    npm install unichat-ts
    ```

2.  Import and initialize `UnifiedChatApi`:

    ```typescript
    import { UnifiedChatApi, Role, Message, CreateCompletionOptions } from 'unichat-ts';

    // Basic initialization with API key
    const client = new UnifiedChatApi({ apiKey: 'YOUR_API_KEY' });

    // Initialization with a custom base URL (e.g., for a proxy or self-hosted endpoint)
    const clientWithCustomUrl = new UnifiedChatApi({
      apiKey: 'YOUR_API_KEY', // API key might still be needed for the custom endpoint
      baseUrl: 'https://your-proxy-or-custom-endpoint.com/v1'
    });
    ```
    The `baseUrl` allows you to direct API calls to a different server endpoint, which is useful for proxy servers or when using self-hosted models that are compatible with OpenAI, Anthropic, or Mistral APIs.

3.  Make API calls, for example, to create a chat completion:

    ```typescript
    async function getChatCompletion() {
      try {
        const messages: Message[] = [
          { role: Role.System, content: "You are a helpful assistant." },
          { role: Role.User, content: "Hello! What is the capital of France?" }
        ];

        const options: CreateCompletionOptions = {
          model: "gpt-4o-mini", // Specify the model
          messages: messages,
          // stream: false, // Set to true for streaming
        };

        const response = await client.chat.completions.create(options);
        console.log(response.choices[0].message.content);

      } catch (error) {
        console.error("Error fetching completion:", error);
      }
    }

    getChatCompletion();
    ```

## Advanced Options for `chat.completions.create()`

The `create` method for chat completions supports several advanced options:

### `reasoningEffort`

*   **Purpose**: Primarily for Anthropic models, this parameter allows you to request different levels of "thinking" or reasoning before the model provides a response. It can also be used with certain OpenAI models if they support a similar feature. Higher reasoning effort may result in more thorough responses but could increase latency and cost.
*   **Type**: `boolean | string`
*   **Example Values**: `true` (for high effort), or specific string values like `"low"`, `"medium"`, `"high"` for applicable models.
*   **Example Usage**:
    ```typescript
    const response = await client.chat.completions.create({
      model: 'claude-3-haiku-20240307', // An Anthropic model
      messages: [{ role: Role.User, content: 'Explain quantum computing in simple terms.' }],
      reasoningEffort: 'medium' // Or true for high effort
    });
    ```

### `cached`

*   **Purpose**: Used with Anthropic models to leverage caching for potentially faster responses and reduced costs on repetitive queries or contexts.
*   **Type**: `boolean | string`
*   **Example Values**:
    *   `true`: Enables general caching.
    *   `"<message_id_to_resume_from>"`: (If supported by the specific API version and model) A string identifier to resume or leverage a specific cached context.
*   **Example Usage**:
    ```typescript
    // First request (populates cache)
    // await client.chat.completions.create({
    //   model: 'claude-3-haiku-20240307',
    //   messages: [{ role: Role.User, content: 'Tell me a fact about the Roman Empire.' }],
    // });

    // Subsequent request, potentially using cache
    const response = await client.chat.completions.create({
      model: 'claude-3-haiku-20240307',
      messages: [{ role: Role.User, content: 'Tell me a fact about the Roman Empire.' }],
      cached: true
    });
    ```

### Other Standard Options
The `create` method also supports standard options like `stream` (boolean), `temperature` (string/number), `tools` (array of tool definitions), etc. Refer to the type definitions in `src/types.ts` for more details.


## Improved Provider Compatibility

This library features enhanced internal handling for different AI providers (OpenAI, Anthropic, Mistral). This ensures a more consistent developer experience, especially for features like tool usage and streaming responses, by normalizing disparate provider APIs into a unified interface.


## Functionality testing:
Try the enclosed `test.ts` file (compile it first using `npm run build`):

```shell
npm test
```
This will run a series of conceptual and (if API key is provided) live tests demonstrating various features.