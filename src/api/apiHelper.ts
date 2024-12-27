import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { Mistral } from '@mistralai/mistralai';

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

  constructor(config: ApiConfig) {
    this.config = config;
    this.models = MODELS_LIST;
    this.max_tokens = MODELS_MAX_TOKEN;
    this.api_client = null;
  }

  public get_max_tokens(model_name: string): number {
    return this.max_tokens[model_name] || ApiHelper.DEFAULT_MAX_TOKENS;
  }

  public get_client(model_name: string): any {
    if (this.api_client) {
      return this.api_client;
    }
    let client = undefined;
    if (this.models.mistral_models.includes(model_name)) {
      client = new Mistral({ apiKey: this.config.apiKey });
    } else if (this.models.anthropic_models.includes(model_name)) {
      client = new Anthropic({ apiKey: this.config.apiKey });
    } else if (this.models.grok_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: 'https://api.x.ai/v1',
      });
    } else if (this.models.gemini_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
    } else if (this.models.deepseek_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: 'https://api.deepseek.com/v1',
      });
    } else if (this.models.openai_models.includes(model_name)) {
      client = new OpenAI({ apiKey: this.config.apiKey });
    } else {
      throw new Error(`Model '${model_name}' not found.`);
    }

    this.api_client = client;
    return client;
  }

  public set_defaults(
    model_name: string,
    conversation: any[],
  ) {
    let role = '';
    if (this.models.anthropic_models.includes(model_name)) {
      role = conversation[0]?.role === 'system' ? conversation[0].content : '';
      conversation = conversation.filter((message) => message.role !== 'system');
    } else if (model_name.startsWith('o1')) {
      if (conversation[0]?.role === 'system') {
        if (model_name === "o1") {
          conversation[0].role = "developer";
        } else {
          const system_content = conversation[0].content;
          conversation[1].content = `${system_content}\n\n${conversation[1].content}`;
          conversation = conversation.filter((message) => message.role !== 'system');
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
    // Extract text content and tool calls
    const textContent = claudeResponse.content
        .filter((block): block is TextContent => block.type === 'text')
        .map(block => block.text)
        .join('\n');

    const toolCalls = claudeResponse.content
        .filter((block): block is ToolUseContent => block.type === 'tool_use')
        .map(block => ({
        id: block.id,
        type: 'function' as const,
        function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
        }
        }));

    // Create single choice combining both
    const choice: GPTChoice = {
        index: 0,
        message: {
        role: claudeResponse.role,
        content: textContent || null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls })
        },
        logprobs: null,
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
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

  public async *transformStream(originalStream: AsyncIterable<AnthropicChunk>): AsyncGenerator<OpenAIChunk> {
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
          } as OpenAIChunk;
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
            } as OpenAIChunk;
          }
          break;
        }

        case 'content_block_delta': {
          if (chunk.delta.type === 'text_delta') {
            yield {
              ...baseChunk,
              choices: [{
                index: 0,
                delta: {
                  content: chunk.delta.text
                },
                logprobs: null,
                finish_reason: null
              }]
            } as OpenAIChunk;
          } else if (chunk.delta.type === 'input_json_delta') {
            yield {
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
            } as OpenAIChunk;
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
              ...baseChunk,
              choices: [{
                index: 0,
                delta: {},
                logprobs: null,
                finish_reason: finish_reason
              }]
            } as OpenAIChunk;
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

  public transformResponse(response: { usage: { promptTokens: any; completionTokens: any; totalTokens: any; }; choices: any[]; }) {
    return {
      ...response,
      usage: {
        prompt_tokens: response.usage.promptTokens,
        completion_tokens: response.usage.completionTokens,
        total_tokens: response.usage.totalTokens
      },
      choices: response.choices.map(choice => ({
        ...choice,
        message: {
          ...choice.message,
          tool_calls: choice.message.toolCalls?.map((toolCall: any) => ({
            ...toolCall
          })),
        },
        finish_reason: choice.finishReason
      }))
    };
  }

  public async * transformStreamChunk(stream: ReadableStream<any>) {
    try {
      for await (const chunk of stream) {
        if (!chunk?.data) continue;

        const data = chunk.data;
        const { toolCalls, finishReason, promptTokens, completionTokens, totalTokens, ...restData } = data;

        yield {
          ...restData,
          usage: data.usage ? {
            prompt_tokens: data.usage.promptTokens,
            completion_tokens: data.usage.completionTokens,
            total_tokens: data.usage.totalTokens
          } : undefined,
          choices: data.choices.map((choice: { [x: string]: any; delta?: any; finishReason: any; toolCalls?: any; }) => {
            const { toolCalls: choiceToolCalls, finishReason: choiceFinishReason, ...restChoice } = choice;
            return {
              ...restChoice,
              delta: choice.delta && {
                ...choice.delta,
                // Remove toolCalls and only keep tool_calls
                toolCalls: undefined,
                tool_calls: choice.delta.toolCalls?.map((toolCall: any) => ({
                  ...toolCall
                }))
              },
              finish_reason: choice.finishReason
            };
          })
        };
      }
    } catch (error) {
      console.error('Error processing stream:', error);
      throw error;
    }
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
            result.push({
              role: Role.User,
                content: [
                    {
                        ...message.content[0],
                        cache_control: {"type": "ephemeral"}
                    }
                ]
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