// Import necessary modules
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { Mistral } from '@mistralai/mistralai';
import { GenerativeLanguageServiceClient } from '@google/generative-ai';

import { MODELS_LIST, MODELS_MAX_TOKEN } from './models'

// Define types for messages
interface Message {
  role: string;
  content: string;
}

export class UnifiedChatApi {
  private api_key: string;
  private _api_helper: ApiHelper;
  public chat: Chat;

  constructor(api_key: string) {
    this.api_key = api_key;
    this._api_helper = new ApiHelper(this.api_key);
    this.chat = new Chat(this._api_helper);
  }
}

class Chat {
  private _api_helper: ApiHelper;
  public completions: Completions;

  constructor(_api_helper: ApiHelper) {
    this._api_helper = _api_helper;
    this.completions = new Completions(_api_helper);
  }
}

class Completions {
  private _api_helper: ApiHelper;
  private _chat_helper: ChatHelper | null;

  constructor(_api_helper: ApiHelper) {
    this._api_helper = _api_helper;
    this._chat_helper = null;
  }

  public async create(
    model: string,
    messages: Message[],
    temperature: string = '1.0',
    stream: boolean = true,
    cached: boolean | string = false,
  ): Promise<AsyncGenerator<string> | string> {
    const { client, conversation, role } = this._api_helper._set_defaults(
      model,
      messages,
      temperature,
    );

    this._chat_helper = new ChatHelper(
      this._api_helper,
      model,
      conversation,
      parseFloat(temperature),
      stream,
      cached,
      client,
      role,
    );

    const response = await this._chat_helper._get_response();
    if (stream) {
      return this._chat_helper._handle_stream(response);
    } else {
      return this._chat_helper._handle_response(response);
    }
  }
}

class ApiHelper {
  private api_key: string;
  public models: any;
  public max_tokens: any;
  public api_client: any;
  public static DEFAULT_MAX_TOKENS: number = 4096;

  constructor(api_key: string) {
    this.api_key = api_key;
    this.models = MODELS_LIST;
    this.max_tokens = MODELS_MAX_TOKEN;
    this.api_client = null;
  }

  private _get_max_tokens(model_name: string): number {
    return this.max_tokens[model_name] || ApiHelper.DEFAULT_MAX_TOKENS;
  }

  public _get_client(model_name: string, temperature: string, role: string = ''): any {
    if (this.api_client) {
      return this.api_client;
    }

    if (this.models.mistral_models.includes(model_name)) {
      const client = new Mistral({ apiKey: this.api_key });
      this.api_client = client;
      return client;
    } else if (this.models.anthropic_models.includes(model_name)) {
      const client = new Anthropic({ apiKey: this.api_key });
      this.api_client = client;
      return client;
    } else if (this.models.grok_models.includes(model_name)) {
      const client = new OpenAI({
        apiKey: this.api_key,
        baseURL: 'https://api.x.ai/v1',
      });
      this.api_client = client;
      return client;
    } else if (this.models.gemini_models.includes(model_name)) {
      const client = new GenerativeLanguageServiceClient({
        apiKey: this.api_key,
      });
      this.api_client = client;
      return client;
    } else if (this.models.openai_models.includes(model_name)) {
      const client = new OpenAI({
        apiKey: this.api_key,
      });
      this.api_client = client;
      return client;
    } else {
      throw new Error(`Model '${model_name}' not found.`);
    }
  }

  public _set_defaults(
    model_name: string,
    conversation: Message[],
    temperature: string,
  ): { client: any; conversation: Message[]; role: string } {
    let role = '';
    if (
      this.models.anthropic_models.includes(model_name) ||
      this.models.gemini_models.includes(model_name) ||
      model_name.startsWith('o1')
    ) {
      role = conversation[0]?.role === 'system' ? conversation[0].content : '';
      conversation = conversation.filter((message) => message.role !== 'system');
    }

    const client = this._get_client(model_name, temperature, role);
    return { client, conversation, role };
  }
}

class ChatHelper {
  private api_helper: ApiHelper;
  private model_name: string;
  private messages: Message[];
  private temperature: number;
  private stream: boolean;
  private cached: boolean | string;
  private client: any;
  private role: string;

  constructor(
    api_helper: ApiHelper,
    model_name: string,
    messages: Message[],
    temperature: number,
    stream: boolean,
    cached: boolean | string,
    client: any,
    role: string,
  ) {
    this.api_helper = api_helper;
    this.model_name = model_name;
    this.messages = messages;
    this.temperature = temperature;
    this.stream = stream;
    this.cached = cached;
    this.client = client;
    this.role = role;
  }

  public async _get_response(): Promise<any> {
    try {
      if (this.api_helper.models.mistral_models.includes(this.model_name)) {
        if (this.stream) {
          return this.client.chat.stream({
            model: this.model_name,
            temperature: this.temperature,
            messages: this.messages,
          });
        } else {
          return this.client.chat.complete({
            model: this.model_name,
            temperature: this.temperature,
            messages: this.messages,
          });
        }
      } else if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        this.temperature = this.temperature > 1 ? 1 : this.temperature;
        const maxTokens = this.api_helper._get_max_tokens(this.model_name);
        if (this.cached === false) {
          return this.client.messages.create({
            model: this.model_name,
            max_tokens: maxTokens,
            temperature: this.temperature,
            messages: this.messages,
            stream: this.stream,
          });
        } else {
          // Handle cached responses (ephemeral messages)
          // Implement caching if necessary
        }
      } else if (this.api_helper.models.gemini_models.includes(this.model_name)) {
        const formattedMessages = this.messages.map((item) => ({
          role: item.role === 'assistant' ? 'model' : item.role,
          content: item.content,
        }));
        const client = this.client as GenerativeLanguageServiceClient;
        const [response] = await client.generateMessage({
          model: this.model_name,
          prompt: {
            context: this.role,
            messages: formattedMessages.slice(0, -1),
          },
          message: formattedMessages[formattedMessages.length - 1].content,
          temperature: this.temperature,
          candidateCount: 1,
        });
        return response;
      } else if (
        this.api_helper.models.grok_models.includes(this.model_name) ||
        this.api_helper.models.openai_models.includes(this.model_name)
      ) {
        return this.client.createChatCompletion(
          {
            model: this.model_name,
            messages: this.messages,
            temperature: this.temperature,
            stream: this.stream,
          });
        };
      } else {
        throw new Error(`Model ${this.model_name} is currently not supported`);
      }
    } catch (e: any) {
      if (e.isAxiosError && e.response) {
        throw new Error(
          `API status error: ${e.response.status} - ${e.response.data.error.message}`,
        );
      } else {
        throw new Error(`An unexpected error occurred: ${e.message}`);
      }
    }
  }

  private _formatAnthropicPrompt(messages: Message[], role: string): string {
    const systemPrompt = role ? `\
\
System: ${role}` : '';
    const formattedMessages = messages
      .map((msg) => `\
\
${msg.role === 'assistant' ? 'Assistant' : 'Human'}: ${msg.content}`)
      .join('');
    return `${systemPrompt}${formattedMessages}\
\
Assistant:`;
  }

  public async _handle_response(response: any): Promise<string> {
    try {
      if (this.api_helper.models.mistral_models.includes(this.model_name)) {
        return response.choices[0].message.content;
      } else if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        return response.completion;
      } else if (this.api_helper.models.gemini_models.includes(this.model_name)) {
        return response.candidates[0].content;
      } else if (
        this.api_helper.models.grok_models.includes(this.model_name) ||
        this.api_helper.models.openai_models.includes(this.model_name)
      ) {
        return response.data.choices[0].message.content;
      } else {
        throw new Error(`Model ${this.model_name} is currently not supported`);
      }
    } catch (e: any) {
      throw new Error(`An unexpected error occurred: ${e.message}`);
    }
  }

  public async *_handle_stream(response: any): AsyncGenerator<string> {
    try {
      if (this.api_helper.models.mistral_models.includes(this.model_name)) {
        for await (const chunk of response) {
          yield chunk.choices[0].delta.content || '';
        }
      } else if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        for await (const data of response) {
          yield data.completion || '';
        }
      } else if (this.api_helper.models.gemini_models.includes(this.model_name)) {
        // Implement streaming for Gemini models if supported
      } else if (
        this.api_helper.models.grok_models.includes(this.model_name) ||
        this.api_helper.models.openai_models.includes(this.model_name)
      ) {
        const stream = response.data;
        for await (const chunk of stream) {
          const content = chunk.choices[0].delta?.content;
          if (content) {
            yield content;
          }
        }
      } else {
        throw new Error(`Model ${this.model_name} is currently not supported`);
      }
    } catch (e: any) {
      throw new Error(`An unexpected error occurred: ${e.message}`);
    }
  }
}