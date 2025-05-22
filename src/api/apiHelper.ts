import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import MistralClient from '@mistralai/mistralai'; // Changed from 'Mistral'

import { MODELS_LIST, MODELS_MAX_TOKEN } from "../models";
import {
    AnthropicChunk,
    ClaudeResponse,
    ContentBlock,
    GPTChoice,
    GPTResponse,
    GPTToolCall,
    InputSchema,
    InputTool,
    Message,
    OpenAIChunk,
    OriginalTool,
    OutputTool,
    Role,
    TextContent,
    ToolUseContent,
    ApiConfig
} from '../types';

export class ApiHelper {
  private config: ApiConfig;
  public readonly models: any;
  private max_tokens: Record<string, number>;
  private api_client: any;
  private static DEFAULT_MAX_TOKENS: number = 4096;
  public anthropic_conversation: Message[] = []; // Added as per subtask

  constructor(config: ApiConfig) {
    this.config = config; // This will now include baseUrl if provided
    this.models = MODELS_LIST;
    this.max_tokens = MODELS_MAX_TOKEN;
    this.api_client = null;
    // The baseUrl is now available in this.config.baseUrl if it was provided
  }

  public get_max_tokens(model_name: string): number {
    return this.max_tokens[model_name] || ApiHelper.DEFAULT_MAX_TOKENS;
  }

  public get_client(model_name: string): any {
    if (this.api_client) {
      return this.api_client;
    }
    let client = undefined;
    // Use this.config.baseUrl if available, otherwise use default URLs
    const baseUrl = this.config.baseUrl;

    if (this.models.mistral_models.includes(model_name)) {
      client = new MistralClient({ apiKey: this.config.apiKey, endpoint: baseUrl }); // Use 'endpoint' for Mistral baseURL
    } else if (this.models.anthropic_models.includes(model_name)) {
      // Anthropic client does not support a custom baseURL in the same way
      // We will use the default URL for Anthropic or handle it differently if needed
      client = new Anthropic({
        apiKey: this.config.apiKey,
        timeout: 600 * 1000, // 10 minutes timeout
        maxRetries: 0,
      });
    } else if (this.models.grok_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: baseUrl || 'https://api.x.ai/v1',
      });
    } else if (this.models.gemini_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
    } else if (this.models.deepseek_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: baseUrl || 'https://api.deepseek.com/v1',
      });
    } else if (this.models.alibaba_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: baseUrl || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      });
    } else if (this.models.openai_models.includes(model_name)) {
      client = new OpenAI({ apiKey: this.config.apiKey, baseURL: baseUrl });
    } else {
      throw new Error(`Model '${model_name}' not found.`);
    }

    this.api_client = client;
    return client;
  }

  public set_defaults(
    model_name: string,
    conversation: Message[], // Changed type from any[] to Message[]
  ) {
    let system_prompt = '';
    let updated_conversation = [...conversation]; // Clone to avoid modifying the original array directly

    if (this.models.anthropic_models.includes(model_name)) {
      if (updated_conversation.length > 0 && updated_conversation[0].role === Role.System) {
        const systemMessage = updated_conversation.shift(); // Remove system message
        if (systemMessage && typeof systemMessage.content === 'string') {
          system_prompt = systemMessage.content;
        } else if (systemMessage && Array.isArray(systemMessage.content) && systemMessage.content[0]?.type === 'text') {
            // Handle cases where system prompt might be in a content block
            system_prompt = (systemMessage.content[0] as TextContent).text;
        }
      }
    } else if (model_name.startsWith("o1") || model_name.startsWith("o3")) { // This logic seems specific, keeping it as is
        if (updated_conversation.length > 0 && updated_conversation[0].role === Role.System) {
            if (model_name === "o1-mini" || model_name === "o1-prewiew") { // "o1-preview" was "o1-prewiew"
                const systemContent = updated_conversation[0].content;
                if (updated_conversation.length > 1) {
                    updated_conversation[1].content = `${systemContent}\n\n${updated_conversation[1].content}`;
                }
                updated_conversation = updated_conversation.slice(1);
            } else {
                updated_conversation[0].role = "developer" as Role; // Cast to Role if "developer" is a valid extension
                updated_conversation[0].content = `Formatting re-enabled\n${updated_conversation[0].content}`;
            }
        }
    }
    // For other models like OpenAI, system messages are generally passed as the first message in the array.
    // No specific transformation is mentioned for them in the Python version beyond what's handled by their SDKs.

    const client = this.get_client(model_name);
    return { client, conversation: updated_conversation, role: system_prompt }; // 'role' is used as system_prompt for anthropic
  }

  // Renaming transformTools to transformToolsToOpenAI as per subtask
  public transformToolsToOpenAI(input: InputTool[]): OutputTool[] {
    return input.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }));
  }

  public normalizeTools = (tools: OriginalTool[] | OutputTool[]): InputTool[] => {
    const defaultSchema: InputSchema = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    };

    return tools.map((tool): InputTool => {
      // Check if it's an OutputTool (has type and function properties)
      if ('type' in tool && 'function' in tool) {
        return {
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters
        };
      }

      // Handle OriginalTool format
      const {
        inputSchema,
        input_schema,
        ...rest
      } = tool;

      return {
        name: rest.name,
        description: rest.description,
        input_schema: inputSchema || input_schema || defaultSchema
      };
    });
  };

  public convertClaudeToGPT(claudeResponse: ClaudeResponse): GPTResponse {
    // Extract text content and tool calls
    const textContent = claudeResponse.content
        .filter((block): block is TextContent => block.type === 'text')
        .map(block => block.text)
        .join('\n');

    const toolCalls = claudeResponse.content
        .filter((block): block is ToolUseContent => block.type === 'tool_use')
        .map(block => {
            try {
                return {
                    id: block.id,
                    type: 'function' as const,
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input),
                    },
                };
            } catch (e: any) {
                console.warn(`[ApiHelper] Failed to stringify tool call input for block ID ${block.id} in convertClaudeToGPT: ${e.message}`);
                return { // Provide a fallback structure
                    id: block.id,
                    type: 'function' as const,
                    function: {
                        name: block.name,
                        arguments: JSON.stringify({ error: "Failed to stringify input", originalInputPreview: String(block.input).substring(0, 100) }),
                    },
                };
            }
        }));

    // Create single choice combining both
    let finish_reason: GPTChoice['finish_reason'] = 'stop';
    if (claudeResponse.stop_reason === "tool_use") {
      finish_reason = "tool_calls";
    } else if (claudeResponse.stop_reason === "end_turn" || claudeResponse.stop_reason === "stop_sequence") {
      finish_reason = "stop";
    } else if (claudeResponse.stop_reason === "max_tokens") {
      finish_reason = "length";
    }
    // Potentially other mappings if claudeResponse.stop_reason has more values

    const choice: GPTChoice = {
        index: 0,
        message: {
        role: claudeResponse.role as Role, // Ensure role is of type Role
        content: textContent || null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls })
        },
        logprobs: null,
        finish_reason: finish_reason
    };

    return {
        id: claudeResponse.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: claudeResponse.model,
        choices: [choice],
        usage: {
        prompt_tokens: claudeResponse.usage.input_tokens,
        completion_tokens: claudeResponse.usage.output_tokens,
        total_tokens: claudeResponse.usage.input_tokens + claudeResponse.usage.output_tokens
        },
        system_fingerprint: 'unichat-ts'
    };
  }

  // Renamed from transformStream to clearly indicate its specific purpose for Anthropic
  private async *transform_anthropic_stream_to_openai(
    originalStream: AsyncIterable<AnthropicChunk>,
    modelName: string // modelName is used for baseChunk
  ): AsyncGenerator<OpenAIChunk> {
    let baseChunk: Partial<OpenAIChunk> = {
      id: `chatcmpl-${Date.now()}`, // Default ID, will be overwritten by message_start
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelName, // Set modelName in the base chunk
      system_fingerprint: 'unichat-ts', // Or null, depending on OpenAI spec for chunks
    };

    let current_message: Message | null = null;
    // Accumulators for the current tool call's arguments if they come in parts
    let current_tool_call_id: string | null = null;
    let current_tool_call_name: string | null = null;
    let current_tool_call_input_buffer = "";
    let tool_call_index = 0; // To assign index to tool_calls delta

    for await (const chunk of originalStream) {
      let transformed_chunk: OpenAIChunk | null = null;

      switch (chunk.type) {
        case 'message_start':
          current_message = {
            role: chunk.message.role as Role,
            content: [], // Initialize content as an array
            // id: chunk.message.id, // Store id if needed for anthropic_conversation
            // model: chunk.message.model, // Store model if needed
            // usage: chunk.message.usage // Store usage if needed
          } as Message; // Cast to Message, assuming id, model, usage are optional for internal recon.
          
          baseChunk.id = chunk.message.id; // Update baseChunk ID from the message
          // baseChunk.model = chunk.message.model; // Model is already set from parameter

          transformed_chunk = {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: { role: chunk.message.role as Role, content: null }, // Content is null initially for message_start
              logprobs: null,
              finish_reason: null,
            }],
          } as OpenAIChunk;
          break;

        case 'content_block_start':
          const contentBlock = chunk.content_block;
          if (contentBlock.type === 'text') {
            // Text block starting, content will come in delta
          } else if (contentBlock.type === 'tool_use') {
            current_tool_call_id = contentBlock.id;
            current_tool_call_name = contentBlock.name;
            current_tool_call_input_buffer = ""; // Reset buffer for new tool
            
            transformed_chunk = {
              ...baseChunk,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: tool_call_index, // Python version uses 0, but if multiple tools, this should increment
                    id: current_tool_call_id,
                    type: 'function',
                    function: { name: current_tool_call_name, arguments: "" }, // Arguments start empty
                  }],
                },
                logprobs: null,
                finish_reason: null,
              }],
            } as OpenAIChunk;
          }
          break;

        case 'content_block_delta':
          const delta = chunk.delta;
          if (delta.type === 'text_delta') {
            if (current_message) {
                current_message = this.appendBlockToMessage(current_message, { type: 'text', text: delta.text });
            }
            transformed_chunk = {
              ...baseChunk,
              choices: [{ index: 0, delta: { content: delta.text }, logprobs: null, finish_reason: null }],
            } as OpenAIChunk;
          } else if (delta.type === 'input_json_delta') {
            current_tool_call_input_buffer += delta.partial_json;
            if (current_tool_call_id && current_tool_call_name) { // Ensure we are inside a tool_use block
                transformed_chunk = {
                ...baseChunk,
                choices: [{
                    index: 0,
                    delta: {
                    tool_calls: [{
                        index: tool_call_index,
                        id: current_tool_call_id, // ID should be set at content_block_start for this tool
                        type: 'function', // type is function for tool_calls
                        function: { name: current_tool_call_name, arguments: delta.partial_json },
                    }],
                    },
                    logprobs: null,
                    finish_reason: null,
                }],
                } as OpenAIChunk;
            }
          }
          break;

        case 'content_block_stop':
          if (current_message && current_tool_call_id && current_tool_call_name) {
            try {
                const full_input = JSON.parse(current_tool_call_input_buffer);
                current_message = this.appendBlockToMessage(current_message, {
                    type: 'tool_use',
                    id: current_tool_call_id,
                    name: current_tool_call_name,
                    input: full_input,
                });
            } catch (e: any) {
                 console.error(`[ApiHelper] Failed to parse tool call input JSON in transform_anthropic_stream_to_openai for tool ${current_tool_call_name} (ID: ${current_tool_call_id}): ${e.message}. Buffer: "${current_tool_call_input_buffer}"`);
                 if (current_message) { // Append an error text message to the current message being built
                    current_message = this.appendBlockToMessage(current_message, {
                        type: 'text',
                        text: `Error: Tool ${current_tool_call_name} (ID: ${current_tool_call_id}) received malformed JSON input.`
                    });
                 }
                 // Optionally, we could also yield a specific error chunk here if the stream consumer is set up for it
            }
            // Reset tool call accumulators
            current_tool_call_id = null;
            current_tool_call_name = null;
            current_tool_call_input_buffer = "";
            tool_call_index++; // Increment for the next potential tool call
          }
          break;

        case 'message_delta': // Anthropic specific
              id: current_tool_call_id,
              name: current_tool_call_name,
              input: full_input,
            });
            // Reset tool call accumulators
            current_tool_call_id = null;
            current_tool_call_name = null;
            current_tool_call_input_buffer = "";
            tool_call_index++; // Increment for the next potential tool call
          }
          break;

        case 'message_delta': // Anthropic specific
          // This contains stop_reason and usage.
          // The Python version also maps this to a finish_reason in the OpenAI chunk.
          let finishReasonDelta: GPTChoice['finish_reason'] = null;
          if (chunk.delta.stop_reason) {
            if (chunk.delta.stop_reason === "tool_use") finishReasonDelta = "tool_calls";
            else if (chunk.delta.stop_reason === "end_turn" || chunk.delta.stop_reason === "stop_sequence") finishReasonDelta = "stop";
            else if (chunk.delta.stop_reason === "max_tokens") finishReasonDelta = "length";
            else finishReasonDelta = chunk.delta.stop_reason as GPTChoice['finish_reason']; // Use as is if not a special case
          }
          
          if (current_message && chunk.delta.usage) {
            // current_message.usage = { ...current_message.usage, output_tokens: chunk.delta.usage.output_tokens };
            // Usage for the full message is available at message_stop or message_start of the *next* message.
            // For streaming, OpenAI spec doesn't put usage in delta. It's part of the final non-stream response.
          }

          transformed_chunk = {
            ...baseChunk,
            choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: finishReasonDelta }],
          } as OpenAIChunk;
          break;
        
        case 'message_stop': // Anthropic specific, signals end of current message stream
            // This is where the Python version might finalize the message and add to anthropic_conversation
            if (current_message) {
                // Optional: Add usage if available in the final message object from Anthropic if not already handled by message_start
                // current_message.usage = { ...current_message.usage, ... (get final usage if available) }
                this.anthropic_conversation.push(current_message);
                current_message = null; // Reset for next message if any
                tool_call_index = 0; // Reset tool call index for the new message
            }
            // A message_stop might not yield a separate OpenAI chunk unless it contains a final finish_reason
            // that wasn't part of message_delta. Typically, message_delta provides the finish_reason.
            break;
      }

      if (transformed_chunk) {
        yield transformed_chunk;
      }
    }
    // If the stream ends and current_message is still populated (e.g. stream ended abruptly before message_stop)
    // you might want to add it to anthropic_conversation here.
    if (current_message) {
        this.anthropic_conversation.push(current_message);
    }
  }

  public transformToolCalls(toolCalls: GPTToolCall[]): ContentBlock[] {
    return toolCalls.map(call => {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch (e) {
        // In case of invalid JSON, pass it as a string in a "parameters" field or similar
        // This behavior should align with how the Python version handles unparseable arguments
        args = { "__raw_args__": call.function.arguments };
        console.warn(`Warning: tool call arguments for ${call.function.name} is not valid JSON. Passing as raw string.`);
      }
      return {
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: args,
      };
    });
  }

  public transformMessages(messages: Message[]): Message[] {
    const transformedMessages: Message[] = [];
    let lastRole: Role | null = null;

    for (let i = 0; i < messages.length; i++) {
      const message = { ...messages[i] }; // Create a shallow copy to avoid modifying original objects directly

      if (message.role === Role.Assistant && message.tool_calls && message.tool_calls.length > 0) {
        // Convert OpenAI tool_calls to Anthropic tool_use content blocks
        message.content = this.transformToolCalls(message.tool_calls);
        delete message.tool_calls; // Remove tool_calls array after transformation
        transformedMessages.push(message);
        lastRole = Role.Assistant;
      } else if (message.role === Role.Tool) {
        // Convert OpenAI tool role message to Anthropic user role message with tool_result content
        const toolMessage: Message = {
          role: Role.User,
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.tool_call_id!, // Non-null assertion, as tool_call_id is required for tool role
              content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
              // TODO: The python version has is_error field, but it's not in TS types yet.
              // is_error: message.is_error // Assuming is_error might be part of the message object
            },
          ],
        };
        transformedMessages.push(toolMessage);
        lastRole = Role.User;
      } else {
        // Regular message (system, user, or assistant text message)
        // Ensure message.content is in the ContentBlock[] format if it's an array
        if (Array.isArray(message.content)) {
            // It's already ContentBlock[], or should be.
            // No specific transformation needed here unless further validation/conversion is required.
        } else if (typeof message.content === 'string') {
            // Convert simple string content to TextContent block if not already
            message.content = [{ type: 'text', text: message.content }];
        }
        // else if (message.content === null || message.content === undefined) {
            // Keep content as null/undefined for models that support it (e.g. OpenAI assistant message with only tool_calls)
            // However, for Anthropic, assistant messages should generally have content.
            // If an assistant message had only tool_calls, it's handled above.
            // If it's an assistant message with no text and no tool_calls, this might be an issue for Anthropic.
        // }

        // Anthropic specific: Ensure no consecutive messages from the same role.
        // The Python version doesn't explicitly show this, but it's a common requirement.
        // For now, this part is omitted as it's not in the direct Python port instructions.
        // if (lastRole && lastRole === message.role && message.role === Role.Assistant) {
        //   transformedMessages.push({role: Role.User, content: [{type: 'text', text: "OK"}]}); // Or some other neutral content
        // }

        transformedMessages.push(message);
        lastRole = message.role;
      }
    }
    return transformedMessages;
  }

  // modelName parameter added as per subtask, though current logic is Mistral-specific
  public transformResponse(response: any, modelName: string): any {
    // This method is primarily for standardizing Mistral's non-streaming response.
    // Other provider responses (OpenAI, Anthropic non-streaming) are generally
    // already in a compatible format or handled by specific converters (e.g., convertClaudeToGPT).
    if (modelName && this.models.mistral_models.includes(modelName.toLowerCase())) {
        // Assuming 'response' is the raw response from the Mistral client
        return {
            id: response.id, // Keep standard fields
            object: response.object,
            created: response.created,
            model: response.model,
            choices: response.choices.map((choice: any) => ({
                index: choice.index,
                message: {
                    role: choice.message.role,
                    content: choice.message.content,
                    // Standardize tool_calls structure if present
                    tool_calls: choice.message.tool_calls?.map((call: any) => ({
                        id: call.id,
                        type: call.type || 'function', // Default type if missing
                        function: {
                            name: call.function.name,
                            arguments: call.function.arguments,
                        },
                    })),
                },
                finish_reason: choice.finish_reason,
                logprobs: choice.logprobs, // Keep if present
            })),
            usage: { // Standardize usage field names
                prompt_tokens: response.usage.prompt_tokens || response.usage.promptTokens,
                completion_tokens: response.usage.completion_tokens || response.usage.completionTokens,
                total_tokens: response.usage.total_tokens || response.usage.totalTokens,
            },
        };
    }
    // For other models, or if modelName is not provided/not Mistral, return response as is.
    return response;
  }

  // Renamed from transformStreamChunk and adjusted to handle a single chunk, primarily for Mistral.
  // The original was an async generator itself, this is now a synchronous method transforming one chunk.
  public transform_stream_chunk(chunk: any, modelName: string): OpenAIChunk | null {
    if (!chunk) return null;
    try {
        // Assuming modelName is primarily for Mistral or models that have a similar chunk structure.
        // This transformation should make it look like an OpenAI chunk.
    // The input 'chunk' structure will depend on the specific SDK (e.g., Mistral's).

    // Example for MistralAI client (older version based on existing TS code):
    // if (chunk?.data) { // This was from the previous TS code, might be specific to how stream was read
    //    const data = chunk.data;
    //    // ... transformation ...
    // }

    // More general approach for a typical Mistral chunk based on their API:
    // A Mistral chunk might look like:
    // { id: '...', object: 'chat.completion.chunk', created: ..., model: '...', choices: [{ index: 0, delta: { role?, content?, tool_calls? }, finish_reason: ...}] }
    // If the chunk is already in OpenAI format (or very close), minimal transformation is needed.

    const openAIChoiceDelta: { role?: Role; content?: string | null; tool_calls?: GPTToolCall[] } = {};
    let finish_reason: GPTChoice['finish_reason'] = null;

    if (chunk.choices && chunk.choices.length > 0) {
      const choice = chunk.choices[0];
      if (choice.delta.role) {
        openAIChoiceDelta.role = choice.delta.role as Role;
      }
      if (choice.delta.content !== undefined) {
        openAIChoiceDelta.content = choice.delta.content;
      }
      if (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) {
        openAIChoiceDelta.tool_calls = choice.delta.tool_calls.map((tc: any, index: number) => ({
          index: tc.index !== undefined ? tc.index : index, // Ensure index is present
          id: tc.id,
          type: tc.type || 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }
      if (choice.finish_reason) {
        finish_reason = choice.finish_reason as GPTChoice['finish_reason'];
      }
    }
    
    // If openAIChoiceDelta is empty and no finish_reason, it might be an empty or metadata chunk.
    // However, the standard is to always have a choices array.
    if (Object.keys(openAIChoiceDelta).length === 0 && !finish_reason && chunk.choices && chunk.choices.length === 0 ) {
        // If choices is empty, create a minimal delta to keep stream alive if needed, or return null
        // For now, if choices is empty, we assume it's not a valid data chunk to transform.
        // However, OpenAI spec expects choices array even if delta is empty.
        // Let's ensure choices is always present.
    }


    return {
      id: chunk.id,
      object: 'chat.completion.chunk', // Standard OpenAI object type
      created: chunk.created || Math.floor(Date.now() / 1000),
      model: chunk.model || modelName, // Use model from chunk if available, else from parameter
      choices: [{
        index: (chunk.choices && chunk.choices.length > 0 && chunk.choices[0].index !== undefined) ? chunk.choices[0].index : 0,
        delta: openAIChoiceDelta,
        logprobs: (chunk.choices && chunk.choices.length > 0) ? chunk.choices[0].logprobs : null, // Keep if present
        finish_reason: finish_reason,
      }],
      // Usage is not part of streaming chunks in OpenAI spec generally.
      // system_fingerprint might be present on some OpenAI chunks.
      system_fingerprint: chunk.system_fingerprint || null,
    };
    } catch (e: any) {
        console.error(`[ApiHelper] Failed to transform stream chunk for model ${modelName}: ${e.message}. Chunk:`, JSON.stringify(chunk).substring(0, 500));
        // Create an OpenAIChunk with an error message in delta.content.
        return {
            id: chunk?.id || `error-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: chunk?.created || Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{
                index: 0,
                delta: { content: `[ERROR] Failed to process stream chunk: ${e.message}` },
                logprobs: null,
                finish_reason: 'stop', 
            }],
            system_fingerprint: null,
        };
    }
  }


  public async *transform_stream(responseStream: any, modelName: string): AsyncGenerator<OpenAIChunk, void, unknown> {
    if (this.models.anthropic_models.includes(modelName)) {
      // Delegate to the specialized Anthropic stream transformer
      // Pass modelName to it for setting in the baseChunk
      yield* this.transform_anthropic_stream_to_openai(responseStream as AsyncIterable<AnthropicChunk>, modelName);
    } else if (this.models.mistral_models.includes(modelName)) {
      for await (const chunk of responseStream) {
        const transformed = this.transform_stream_chunk(chunk, modelName);
        if (transformed) {
          yield transformed;
        }
      }
    } else { // OpenAI and other compatible models
      for await (const chunk of responseStream) {
        // Assuming these are already in OpenAI chunk format
        // If not, a more specific transformation might be needed here too
        yield chunk as OpenAIChunk;
      }
    }
  }


  public cacheMessages(messages: Message[]): Message[] {
    const result: Message[] = [];
    let userMessages = 0;

    // Iterate through messages in reverse order
    for (const originalMessage of [...messages].reverse()) {
        const message = { ...originalMessage }; // Shallow copy to avoid modifying original objects in the input array

        if (message.role === Role.User && userMessages < 2) {
            if (typeof message.content === 'string') {
                message.content = [
                    {
                        type: "text",
                        text: message.content,
                        cache_control: { "type": "ephemeral" }
                    } as TextContent, // Ensure it's a TextContent
                ];
            } else if (Array.isArray(message.content)) {
                // Content is already an array of blocks, add cache_control to each block
                message.content = message.content.map(block => {
                    if (typeof block === 'object' && block !== null && 'type' in block) {
                        return { ...block, cache_control: { "type": "ephemeral" } };
                    }
                    return block; // Should not happen if ContentBlock[] is well-formed
                });
            }
            userMessages += 1;
        }
        result.push(message);
    }

    return result.reverse();
  }

  // New method: blockToDict
  public blockToDict(block: any): any {
    try {
      if (!block || !block.type) {
        // console.warn("[ApiHelper] Attempted to convert an invalid block to dict:", block);
        // Return null or throw a more specific error if this case should be strictly handled
        return null; 
      }

      const blockDict: any = { type: block.type };

      if (block.type === 'text' && typeof block.text === 'string') {
        blockDict.text = block.text;
      } else if (block.type === 'tool_use' && block.id && block.name && block.input !== undefined) {
        blockDict.id = block.id;
        blockDict.name = block.name;
        blockDict.input = block.input; 
      } else if (block.type === 'tool_result' && block.tool_use_id && block.content !== undefined) {
        blockDict.tool_use_id = block.tool_use_id;
        blockDict.content = block.content;
        if (block.is_error !== undefined) {
          blockDict.is_error = block.is_error;
        }
        if (block.id) {
            blockDict.id = block.id;
        }
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        // Keep these types as is, specific properties might not be needed for dict conversion if only type matters
      } else {
         // console.warn(`[ApiHelper] Unknown or incomplete block type for blockToDict: ${block.type}. Block:`, JSON.stringify(block).substring(0,500));
         // Fallback to returning the original block if it's not one of the known types or structure is unexpected.
         // Or, return just the type: return { type: block.type };
         return block; // Or a more specific error/logging
      }
      return blockDict;
    } catch (e: any) {
        console.error(`[ApiHelper] Error in blockToDict: ${e.message}. Block:`, JSON.stringify(block).substring(0,500));
        // Re-throw or return a specific error object
        throw new Error(`Failed to convert block to dictionary: ${e.message}`);
    }
  }

  public appendBlockToMessage(message: Message, block_dict: any): Message {
    try {
      if (!block_dict || !block_dict.type) {
         console.warn("[ApiHelper] Attempted to append an invalid or typeless block_dict to message. Skipping append. Block dict:", block_dict);
        return message; 
      }

      const newMessage = { ...message };
      if (!Array.isArray(newMessage.content)) {
          newMessage.content = typeof newMessage.content === 'string' ? [{type: 'text', text: newMessage.content } as TextContent] : [];
      }

      const contentArray = newMessage.content as ContentBlock[];

      if (block_dict.type === 'text' && typeof block_dict.text === 'string') {
        const lastContent = contentArray.length > 0 ? contentArray[contentArray.length - 1] : null;
        if (lastContent && lastContent.type === 'text') {
          lastContent.text += block_dict.text;
        } else {
          contentArray.push({ type: 'text', text: block_dict.text } as TextContent);
        }
      } else if (block_dict.type === 'tool_use' && block_dict.id && block_dict.name && block_dict.input !== undefined) {
        contentArray.push({
          type: 'tool_use',
          id: block_dict.id,
          name: block_dict.name,
          input: block_dict.input,
        } as ToolUseContent);
      } else if (block_dict.type === 'tool_result' && block_dict.tool_use_id && block_dict.content !== undefined) {
         contentArray.push({
            type: 'tool_result',
            tool_use_id: block_dict.tool_use_id,
            content: block_dict.content, 
            is_error: block_dict.is_error,
            id: block_dict.id
         } as ToolResult);
      } else if (block_dict.type === 'thinking' || block_dict.type === 'redacted_thinking') {
          // If these types should be appended to content, add them here.
          // For now, assuming they are intermediate and not part of final message content via this method.
          // console.log(`[ApiHelper] Skipping append of '${block_dict.type}' block to message content.`);
      } else {
          console.warn(`[ApiHelper] Cannot append unknown or incomplete block type '${block_dict.type}' to message. Block:`, JSON.stringify(block_dict).substring(0,500))
      }
      
      newMessage.content = contentArray;
      return newMessage;
    } catch (e: any) {
        console.error(`[ApiHelper] Error in appendBlockToMessage: ${e.message}. Message:`, JSON.stringify(message).substring(0,500), "Block dict:", JSON.stringify(block_dict).substring(0,500));
        throw new Error(`Failed to append block to message: ${e.message}`);
    }
  }
}