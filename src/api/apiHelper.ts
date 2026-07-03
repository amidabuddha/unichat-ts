import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

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
    TransformedResponse,
    TextContent,
    ToolUseContent,
    ApiConfig
} from '../types';

export class ApiHelper {
  private config: ApiConfig;
  public readonly models: Record<string, string[] | undefined>;
  private max_tokens: Record<string, number>;
  private api_clients: {
    anthropic?: Anthropic;
    openai?: OpenAI;
  };
  public anthropic_conversation: Message[];
  private static DEFAULT_MAX_TOKENS: number = 4096;

  constructor(config: ApiConfig) {
    this.config = config;
    this.models = { ...MODELS_LIST };
    this.max_tokens = MODELS_MAX_TOKEN;
    this.api_clients = {};
    this.anthropic_conversation = [];
  }

  public get_max_tokens(model_name: string): number {
    return this.max_tokens[model_name] || ApiHelper.DEFAULT_MAX_TOKENS;
  }

  public get_model_list(providerKey: string): string[] {
    return this.models[providerKey] ?? [];
  }

  public has_model(providerKey: string, model_name: string): boolean {
    return this.get_model_list(providerKey).includes(model_name);
  }

  public get_client(model_name: string): any {
    if (this.has_model("anthropic_models", model_name)) {
      if (!this.api_clients.anthropic) {
        this.api_clients.anthropic = new Anthropic({ apiKey: this.config.apiKey });
      }
      return this.api_clients.anthropic;
    }

    if (!this.api_clients.openai) {
      this.api_clients.openai = new OpenAI({
        apiKey: this.config.apiKey,
        ...(this.config.baseURL ? { baseURL: this.config.baseURL } : {})
      });
    }
    return this.api_clients.openai;
  }

  public set_defaults(
    model_name: string,
    conversation: any[],
  ) {
    let role = '';
    if (this.has_model("anthropic_models", model_name)) {
      role = conversation[0]?.role === 'system' ? conversation[0].content : '';
      conversation = conversation.filter((message) => message.role !== 'system');
    } else if (this.has_model("openai_models", model_name)) {
        if (conversation[0]?.role === "system") {
            conversation[0].role = "developer";
            conversation[0].content = `Formatting re-enabled\n${conversation[0].content}`;
        }
    } else if (model_name.startsWith("o1") || model_name.startsWith("o3")) {
        if (conversation[0]?.role === "system") {
            if (model_name === "o1-mini" || model_name === "o1-prewiew") {
                const systemContent = conversation[0].content;
                conversation[1].content = `${systemContent}\n\n${conversation[1].content}`;
                conversation = conversation.filter(message => message.role !== "system");
            } else {
                conversation[0].role = "developer";
                conversation[0].content = `Formatting re-enabled\n${conversation[0].content}`;
            }
        }
    }
    const client = this.get_client(model_name);
    return { client, conversation, role };
  }

  public transformTools(input: InputTool[]): OutputTool[] {
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
    const textContent: string[] = [];
    let reasoningContent = "";
    let hasToolUse = false;

    const toolCalls = claudeResponse.content
      .filter((block): block is ToolUseContent => {
        if (block.type === 'tool_use') {
          hasToolUse = true;
          return true;
        }
        if (block.type === 'text') {
          textContent.push(block.text);
        }
        if (block.type === 'thinking') {
          reasoningContent = block.thinking;
        }
        return false;
      })
      .map(block => ({
        id: block.id,
        type: 'function' as const,
        function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
        }
      }));

    const message = {
      role: claudeResponse.role,
      content: textContent.join('') || null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      ...(hasToolUse ? { tool_calls: toolCalls } : {})
    };

    const finishReason = claudeResponse.stop_reason === 'tool_use'
      ? 'tool_calls'
      : claudeResponse.stop_reason === 'end_turn'
        ? 'stop'
        : claudeResponse.stop_reason;

    const choice: GPTChoice = {
        index: 0,
        message,
        logprobs: null,
        finish_reason: finishReason
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

  public async *transformStream(originalStream: AsyncIterable<AnthropicChunk>): AsyncGenerator<{ transformedChunk: OpenAIChunk | null; originalBlock: TransformedResponse | null }> {
    let baseChunk: Partial<OpenAIChunk> = {
      object: 'chat.completion.chunk',
      created: Date.now(),
      system_fingerprint: 'unichat-ts',
    };

    let currentToolCall: {
      index: number;
      id?: string;
      type?: 'function';
      functionName?: string;
      functionArguments?: string;
    } | null = null;


    for await (const chunk of originalStream) {
      switch (chunk.type) {
        case 'message_start': {
          baseChunk = {
            ...baseChunk,
            id: chunk.message.id,
            model: chunk.message.model,
          };

          yield {
            transformedChunk: {
            ...baseChunk,
            choices: [{
              index: 0,
              delta: {
                role: chunk.message.role,
                content: "",
                refusal: null
              },
              logprobs: null,
              finish_reason: null
            }]
            } as OpenAIChunk,
            originalBlock: null
          };
          break;
        }

        case 'content_block_start': {
          if (chunk.content_block.type === 'tool_use') {
            currentToolCall = {
              index: 0,
              id: chunk.content_block.id,
              functionName: chunk.content_block.name,
              functionArguments: '',

            };
            yield {
              transformedChunk: {
              ...baseChunk,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: currentToolCall.id,
                    type: 'function',
                    function: {
                      name: currentToolCall.functionName,
                      arguments: currentToolCall.functionArguments
                    }
                  }]
                },
                logprobs: null,
                finish_reason: null
              }]
              } as OpenAIChunk,
              originalBlock: {
                role: Role.Assistant,
                content: [{
                  type: 'tool_use',
                  id: chunk.content_block.id ?? '',
                  name: chunk.content_block.name ?? '',
                  input: ''
                }]
              }
            };
          } else if (chunk.content_block.type === 'redacted_thinking') {
            yield {
              transformedChunk: null,
              originalBlock: {
                role: Role.Assistant,
                content: [{
                  type: 'redacted_thinking',
                  data: chunk.content_block.data ?? ''
                }]
              }
            };
          }
          break;
        }

        case 'content_block_delta': {
          if (chunk.delta.type === 'text_delta') {
            yield {
              transformedChunk: {
              ...baseChunk,
              choices: [{
                index: 0,
                delta: {
                  content: chunk.delta.text
                },
                logprobs: null,
                finish_reason: null
              }]
              } as OpenAIChunk,
              originalBlock: {
                role: Role.Assistant,
                content: [{
                  type: 'text',
                  text: chunk.delta.text ?? ''
                }]
              }
            };
          } else if (chunk.delta.type === 'thinking_delta') {
            yield {
              transformedChunk: {
                ...baseChunk,
                choices: [{
                  index: 0,
                  delta: {
                    reasoning_content: chunk.delta.thinking
                  },
                  logprobs: null,
                  finish_reason: null
                }]
              } as OpenAIChunk,
              originalBlock: {
                role: Role.Assistant,
                content: [{
                  type: 'thinking',
                  thinking: chunk.delta.thinking ?? '',
                  signature: ''
                }]
              }
            };
          } else if (chunk.delta.type === 'signature_delta') {
            yield {
              transformedChunk: null,
              originalBlock: {
                role: Role.Assistant,
                content: [{
                  type: 'thinking',
                  thinking: '',
                  signature: chunk.delta.signature ?? ''
                }]
              }
            };
          } else if (chunk.delta.type === 'input_json_delta') {
            yield {
              transformedChunk: {
              ...baseChunk,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    function: {
                      arguments: chunk.delta.partial_json
                    }
                  }]
                },
                logprobs: null,
                finish_reason: null
              }]
              } as OpenAIChunk,
              originalBlock: {
                role: Role.Assistant,
                content: [{
                  type: 'tool_use',
                  id: '',
                  name: '',
                  input: chunk.delta.partial_json ?? ''
                }]
              }
            };
          }
          break;
        }

        case 'content_block_stop': {
          if (currentToolCall) {
            currentToolCall = null;
          }
          break;
        }

        case 'message_delta': {
          if (chunk.delta.stop_reason) {
            const finish_reason = chunk.delta.stop_reason === 'tool_use' ? 'tool_calls' :
                                  chunk.delta.stop_reason === 'end_turn' ? 'stop' :
                                  chunk.delta.stop_reason;

            yield {
              transformedChunk: {
              ...baseChunk,
              choices: [{
                index: 0,
                delta: {},
                logprobs: null,
                finish_reason: finish_reason
              }]
              } as OpenAIChunk,
              originalBlock: null
            };
          }
          break;
        }
      }
    }
  }

  public transformToolCalls(toolCalls: GPTToolCall[]): ContentBlock[] {
    return toolCalls.map(call => ({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: JSON.parse(call.function.arguments)
    }));
  }

  public transformMessages(messages: Message[]): Message[] {
    const transformedMessages: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];

        if (message.role === Role.Assistant && message.tool_calls) {
            // Transform and add the assistant message
            transformedMessages.push({
                role: Role.Assistant,
                content: this.transformToolCalls(message.tool_calls)
            });

            // Look ahead for the corresponding tool response
            if (i + 1 < messages.length && messages[i + 1].role === Role.Tool) {
                const toolMsg = messages[i + 1];
                transformedMessages.push({
                    role: Role.User,
                    content: [{
                        type: 'tool_result',
                        tool_use_id: toolMsg.tool_call_id,
                        content: toolMsg.content,
                    }]
                });
                i++; // Skip the tool message since we've handled it
            }
        } else if (message.role !== Role.Tool) { // Skip tool messages as they're handled above
            transformedMessages.push(message);
        }
    }

    return transformedMessages;
}

  public blockToDict(block: any): ContentBlock | undefined {
    switch (block?.type) {
      case "thinking":
        return {
          signature: block.signature,
          thinking: block.thinking,
          type: "thinking"
        };
      case "redacted_thinking":
        return {
          data: block.data,
          type: "redacted_thinking"
        };
      case "tool_use":
        return {
          id: block.id,
          name: block.name,
          type: "tool_use",
          input: block.input
        };
      case "text":
        return {
          text: block.text,
          type: "text"
        };
      default:
        return undefined;
    }
  }

  public appendBlockToMessage(message: Message, block: TransformedResponse): Message {
    const blockContent = block.content[0];
    if (!blockContent) {
      return message;
    }

    if (!Array.isArray(message.content)) {
      message.content = [];
    }

    if (blockContent.type === "tool_use") {
      if (blockContent.id) {
        message.content.push({
          type: "tool_use",
          id: blockContent.id,
          name: blockContent.name,
          input: blockContent.input
        });
      } else {
        const lastBlock = message.content[message.content.length - 1];
        if (lastBlock?.type === "tool_use") {
          lastBlock.input = `${lastBlock.input}${blockContent.input}`;
        }
      }
    } else if (blockContent.type === "thinking") {
      const lastBlock = message.content[message.content.length - 1];
      if (lastBlock?.type === "thinking") {
        if (blockContent.thinking) {
          lastBlock.thinking += blockContent.thinking;
        }
        if (blockContent.signature) {
          lastBlock.signature = blockContent.signature;
        }
      } else {
        message.content.push({
          type: "thinking",
          thinking: blockContent.thinking,
          signature: blockContent.signature
        });
      }
    } else if (blockContent.type === "text") {
      const lastBlock = message.content[message.content.length - 1];
      if (lastBlock?.type === "text") {
        lastBlock.text += blockContent.text;
      } else {
        message.content.push({
          type: "text",
          text: blockContent.text
        });
      }
    } else if (blockContent.type === "redacted_thinking") {
      message.content.push(blockContent);
    }

    return message;
  }

  private isCacheEligibleBlock(block: any): boolean {
    if (!block || typeof block !== "object") {
      return false;
    }

    if (block.type === "text") {
      return Boolean(block.text);
    }

    return ["image", "document", "tool_result", "tool_use"].includes(block.type);
  }

  public cacheMessages(messages: Message[]): Message[] {
    const result: Message[] = [];
    let userMessages = 0;

    // Iterate through messages in reverse order
    for (const message of [...messages].reverse()) {
        // Add regular user mesasge to cache
        if (message.role === "user" && userMessages < 2 && typeof message.content === "string") {
            result.push({
                role: Role.User,
                content: [
                  {
                    type: "text",
                    text: message["content"],
                    cache_control: {"type": "ephemeral"}
                  }
                ]
            });
            userMessages += 1;
        }
        // Add tool result user mesasge to cache
        else if (message.role === "user" && userMessages < 2 && (Array.isArray(message.content) && message.content.length && typeof message.content[0] === "object")) {
            const cachedContent = message.content.map(block => (
              block && typeof block === "object" ? { ...block } : block
            ));

            for (let idx = cachedContent.length - 1; idx >= 0; idx--) {
              if (this.isCacheEligibleBlock(cachedContent[idx])) {
                cachedContent[idx] = {
                  ...cachedContent[idx],
                  cache_control: {"type": "ephemeral"}
                };
                break;
              }
            }

            result.push({
              role: Role.User,
                content: cachedContent
            });
            userMessages += 1;
        }
        else {
            result.push(message);
        }
    }

    return result.reverse();
  }
}
