import { ClaudeRequest, InputTool, Message, Role } from '../types'; // Added Role
import { ApiHelper } from './apiHelper';
import {
    APIError as OpenAIAPIError,
    APIConnectionError as OpenAIAPIConnectionError,
    RateLimitError as OpenAIRateLimitError,
    BadRequestError as OpenAIBadRequestError,
} from 'openai';
import {
    APIError as AnthropicAPIError,
    APIConnectionError as AnthropicAPIConnectionError,
    RateLimitError as AnthropicRateLimitError,
    BadRequestError as AnthropicBadRequestError,
} from '@anthropic-ai/sdk';
// For MistralAI, specific error types might not be exported directly in older versions.
// We'll handle Mistral errors by checking properties of the error object if specific types aren't available.
// import { MistralAPIError } from '@mistralai/mistralai'; // Example if it existed

export class ChatHelper {
  private api_helper: ApiHelper;
  private model_name: string;
  private messages: Message[];
  private temperature: number;
  private tools: InputTool[];
  private stream: boolean;
  private cached: boolean | string;
  private client: any;
  private role: string;
  private reasoningEffort: boolean | string;

  constructor(
    api_helper: ApiHelper,
    model_name: string,
    messages: Message[],
    temperature: number,
    tools: InputTool[],
    stream: boolean,
    cached: boolean | string,
    client: any,
    role: string,
    reasoningEffort: boolean | string,
  ) {
    this.api_helper = api_helper;
    this.model_name = model_name;
    this.messages = messages;
    this.temperature = temperature;
    this.tools = tools;
    this.stream = stream;
    this.cached = cached;
    this.client = client;
    this.role = role;
    this.reasoningEffort = reasoningEffort;
  }

  public async get_response(): Promise<any> {
    try {
      // Ensure client is initialized (moved from set_defaults as client is passed in constructor)
      if (!this.client) {
        throw new Error("API client is not initialized.");
      }
      const model_type = this.api_helper.models; 

      if (model_type.anthropic_models.includes(this.model_name)) {
        const transformed_messages = this.api_helper.transformMessages(this.messages);
        
        // Append the last user message to anthropic_conversation for context
        // The Python version appends the *user's* last message.
        // If messages always end with user message, this is fine.
        // Or, if it means the entire current conversation to be sent.
        // For now, let's assume transformed_messages is what's sent.
        // anthropic_conversation is more for maintaining state across calls if needed or for stream reconstruction.
        // The Python code does: `self.api_helper.anthropic_conversation.append(transformed_messages[-1])`
        // This implies only the very last message. Let's replicate this.
        if (transformed_messages.length > 0) {
             this.api_helper.anthropic_conversation.push(transformed_messages[transformed_messages.length - 1]);
        }

        const anthropicParams: any = { // Use 'any' for flexibility, refine with ClaudeRequest if possible
            model: this.model_name,
            max_tokens: this.api_helper.get_max_tokens(this.model_name),
            temperature: this.reasoningEffort ? 1.0 : Math.min(this.temperature, 1.0),
            stream: this.stream,
        };

        if (this.tools && this.tools.length > 0) {
            const toolsCopy = JSON.parse(JSON.stringify(this.tools)); // Deep copy
            toolsCopy[toolsCopy.length -1].cache_control = { type: "ephemeral" };
            anthropicParams.tools = toolsCopy;
        }

        if (this.role) { // system prompt
            if (typeof this.cached === 'string' && this.cached) {
                 anthropicParams.system = [
                    { type: "text", text: this.role },
                    { type: "text", text: this.cached, cache_control: { type: "ephemeral" } },
                ];
            } else {
                anthropicParams.system = this.role;
            }
        }
        
        // Determine thinking effort based on reasoningEffort
        if (typeof this.reasoningEffort === 'string') {
            anthropicParams.metadata = { ...anthropicParams.metadata, thinking_effort: this.reasoningEffort };
        } else if (this.reasoningEffort === true) {
            anthropicParams.metadata = { ...anthropicParams.metadata, thinking_effort: "high" };
        }


        // Use cached_messages for the actual messages sent
        anthropicParams.messages = this.api_helper.cacheMessages(this.api_helper.anthropic_conversation);
        
        return await this.client.messages.create(anthropicParams);

      } else if (model_type.mistral_models.includes(this.model_name)) {
        const mistralParams: any = {
          model: this.model_name,
          temperature: this.temperature,
          messages: this.messages, // Mistral uses OpenAI message format
        };
        if (this.tools && this.tools.length > 0) {
          mistralParams.tools = this.api_helper.transformToolsToOpenAI(this.tools);
        }
        
        if (this.stream) {
          return await this.client.chat.stream(mistralParams);
        } else {
          return await this.client.chat.completions.create(mistralParams); // Corrected from client.chat.complete
        }

      } else if (
        model_type.grok_models.includes(this.model_name) ||
        model_type.openai_models.includes(this.model_name) ||
        model_type.gemini_models.includes(this.model_name) || // Assuming these follow OpenAI-like params
        model_type.deepseek_models.includes(this.model_name) ||
        model_type.alibaba_models.includes(this.model_name)
      ) {
        const params: any = {
          model: this.model_name,
          messages: this.messages,
          stream: this.stream,
        };

        // Conditional temperature based on Python logic
        if (!this.model_name.endsWith("reasoner") && this.model_name !== "o1" && this.model_name !== "o3-mini") {
          params.temperature = this.temperature;
        }

        if (this.tools && this.tools.length > 0) {
            // Conditional tools based on Python logic
            if (!this.model_name.endsWith("reasoner") && this.model_name !== "o1-preview" && this.model_name !== "o1-mini") {
                 params.tools = this.api_helper.transformToolsToOpenAI(this.tools);
            }
        }
        
        // Reasoning effort for specific models (e.g. o3-mini)
        if (this.model_name === "o3-mini" || (typeof this.reasoningEffort === 'string' && this.reasoningEffort !== 'auto') ) {
             params.reasoning_effort = typeof this.reasoningEffort === 'string' && this.reasoningEffort !== 'auto' ? this.reasoningEffort : "high";
        } else if (this.reasoningEffort === true) {
             params.reasoning_effort = "high";
        }


        return await this.client.chat.completions.create(params);
      } else {
        throw new Error(`Model ${this.model_name} is currently not supported by ChatHelper.`);
      }
    } catch (e: any) {
      // Standardized error handling
      // OpenAI Errors
      if (e instanceof OpenAIRateLimitError) {
        throw new Error(`OpenAI Rate Limit Exceeded: ${e.message} (Status: ${e.status})`);
      } else if (e instanceof OpenAIAPIConnectionError) {
        throw new Error(`OpenAI API Connection Error: ${e.message}`);
      } else if (e instanceof OpenAIBadRequestError) {
        throw new Error(`OpenAI Bad Request: ${e.message} (Status: ${e.status})`);
      } else if (e instanceof OpenAIAPIError) {
        throw new Error(`OpenAI API Error: ${e.message} (Status: ${e.status})`);
      }
      // Anthropic Errors
      else if (e instanceof AnthropicRateLimitError) {
        throw new Error(`Anthropic Rate Limit Exceeded: ${e.message} (Status: ${e.status})`);
      } else if (e instanceof AnthropicAPIConnectionError) {
        throw new Error(`Anthropic API Connection Error: ${e.message}`);
      } else if (e instanceof AnthropicBadRequestError) {
        throw new Error(`Anthropic Bad Request: ${e.message} (Status: ${e.status})`);
      } else if (e instanceof AnthropicAPIError) {
        throw new Error(`Anthropic API Error: ${e.message} (Status: ${e.status})`);
      }
      // Mistral Errors (assuming generic structure if specific types not available)
      // Check for e.response.data for Mistral or other similaraxios-based SDKs
      else if (e.response && e.response.data && e.response.data.message) { // Example structure for Mistral
        const errorData = e.response.data;
        const status = e.response.status;
        // You might need to parse errorData.message or errorData.type to categorize further
        if (status === 429) {
            throw new Error(`Mistral Rate Limit Exceeded: ${errorData.message} (Status: ${status})`);
        } else if (status >= 400 && status < 500) {
            throw new Error(`Mistral Bad Request: ${errorData.message} (Status: ${status})`);
        } else {
            throw new Error(`Mistral API Error: ${errorData.message} (Status: ${status})`);
        }
      }
      // Fallback for other errors
      else if (e.message) {
        throw new Error(`An unexpected API error occurred: ${e.message}`);
      } else {
        throw new Error('An unexpected and unspecified error occurred during the API request.');
      }
    }
  }

  public async handle_response(response: any): Promise<any> {
    try {
      if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        if (response.content && response.role === Role.Assistant) { // Ensure Role.Assistant is correctly typed or string
            const assistantMessage: Message = {
                role: Role.Assistant, // Use imported Role enum
                content: response.content.map((block: any) => this.api_helper.blockToDict(block)).filter((b: any) => b !== null),
            };
            this.api_helper.anthropic_conversation.push(assistantMessage);
        }
        return this.api_helper.convertClaudeToGPT(response as ClaudeResponse);
      } else if (this.api_helper.models.mistral_models.includes(this.model_name)) {
        return this.api_helper.transformResponse(response, this.model_name);
      }
      return response;
    } catch (e: any) {
      console.error(`[ChatHelper] Error in handle_response for model ${this.model_name}: ${e.message}. Response:`, JSON.stringify(response).substring(0,500));
      throw new Error(`Failed to handle API response: ${e.message}`);
    }
  }

  public async *handle_stream(responseStream: any): AsyncGenerator<any, void, unknown> {
    try {
      yield* this.api_helper.transform_stream(responseStream, this.model_name);
    } catch (e: any) {
      console.error(`[ChatHelper] Error in handle_stream for model ${this.model_name}: ${e.message}`);
      // Check if it's an error from transform_stream_chunk (which creates a specific error chunk)
      if (e instanceof Error && e.message.includes("[ERROR] Failed to process stream chunk")) {
          // If transform_stream_chunk already formats errors as OpenAIChunks, re-throw specialized error or the chunk itself
          // For now, let's assume transform_stream_chunk might throw an error that needs to be caught here
          // or it yields an error chunk that should be passed through.
          // The current ApiHelper.transform_stream_chunk returns an error chunk, so it should be yielded.
          // This catch block here is more for unexpected errors during the iteration itself in ApiHelper.transform_stream.
          throw new Error(`Stream processing error for ${this.model_name}: ${e.message}`);
      } else {
          // Generic stream error
          throw new Error(`Stream error for ${this.model_name}: ${e.message}`);
      }
    }
  }
}