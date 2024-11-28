import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { Mistral } from '@mistralai/mistralai';

import { MODELS_LIST, MODELS_MAX_TOKEN } from './models';

import {Role, Message, CreateCompletionOptions} from './types';

export class UnifiedChatApi {
  private api_key: string;
  private api_helper: ApiHelper;
  public chat: Chat;

  constructor(api_key: string) {
    this.api_key = api_key;
    this.api_helper = new ApiHelper(this.api_key);
    this.chat = new Chat(this.api_helper);
  }
}

class Chat {
  private api_helper: ApiHelper;
  public completions: Completions;

  constructor(api_helper: ApiHelper) {
    this.api_helper = api_helper;
    this.completions = new Completions(api_helper);
  }
}

class Completions {
  private api_helper: ApiHelper;
  private chat_helper: ChatHelper | null;

  constructor(api_helper: ApiHelper) {
    this.api_helper = api_helper;
    this.chat_helper = null;
  }

  public async create(options: CreateCompletionOptions): Promise<string | AsyncIterable<string>> {
    const {
      model,
      messages,
      temperature = '1.0',
      stream = true,
      cached  = false
    } = options;
    const { client, conversation, role } = this.api_helper.set_defaults(
      model,
      messages,
    );

    this.chat_helper = new ChatHelper(
      this.api_helper,
      model,
      conversation,
      parseFloat(temperature),
      stream,
      cached,
      client,
      role,
    );

    const response = await this.chat_helper.get_response();
    if (stream) {
      return this.chat_helper.handle_stream(response);
    } else {
      return await this.chat_helper.handle_response(response);
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

  public get_max_tokens(model_name: string): number {
    return Number(this.max_tokens[model_name]) || ApiHelper.DEFAULT_MAX_TOKENS;
  }

  public get_client(model_name: string): any {
    if (this.api_client) {
      return this.api_client;
    }
    let client = undefined;
    if (this.models.mistral_models.includes(model_name)) {
      client = new Mistral({ apiKey: this.api_key });
    } else if (this.models.anthropic_models.includes(model_name)) {
      client = new Anthropic({ apiKey: this.api_key });
    } else if (this.models.grok_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: this.api_key,
        baseURL: 'https://api.x.ai/v1',
      });
    } else if (this.models.gemini_models.includes(model_name)) {
      client = new OpenAI({
        apiKey: 'GEMINI_API_KEY',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
    } else if (this.models.openai_models.includes(model_name)) {
      client = new OpenAI({ apiKey: this.api_key });
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
    if (
      this.models.anthropic_models.includes(model_name) ||
      model_name.startsWith('o1')
    ) {
      role = conversation[0]?.role === 'system' ? conversation[0].content : '';
      conversation = conversation.filter((message) => message.role !== 'system');
    }
    const client = this.get_client(model_name);
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

  public async get_response() {
    try {
      if (this.api_helper.models.mistral_models.includes(this.model_name)) {
        if (this.stream) {
          return await this.client.chat.stream({
            model: this.model_name,
            temperature: this.temperature,
            messages: this.messages,
          });
        } else {
          return await this.client.chat.complete({
            model: this.model_name,
            temperature: this.temperature,
            messages: this.messages,
          });
        }
      } else if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        this.temperature = this.temperature > 1 ? 1 : this.temperature;
        const maxTokens = this.api_helper.get_max_tokens(this.model_name);
        if (this.cached === false) {
          return await this.client.messages.create({
            model: this.model_name,
            max_tokens: maxTokens,
            temperature: this.temperature,
            system: this.role,
            messages: this.messages,
            stream: this.stream,
          });
        } else {
          return await this.client.beta.prompt_caching.message.create({
            model: this.model_name,
            max_tokens: maxTokens,
            temperature: this.temperature,
            system: [
                {"type": "text", "text": this.role},
                {"type": "text", "text": this.cached, "cache_control": {"type": "ephemeral"}},
            ],
            messages: this.messages,
            stream: this.stream,
          })
        }
      } else if (
        this.api_helper.models.grok_models.includes(this.model_name) ||
        this.api_helper.models.openai_models.includes(this.model_name) ||
        this.api_helper.models.gemini_models.includes(this.model_name)
      ) {
        return await this.client.chat.completions.create({
          model: this.model_name,
          messages: this.messages,
          temperature: this.temperature,
          stream: this.stream,
        });
      } else {
        throw new Error(`Model ${this.model_name} is currently not supported`);
      }
    } catch (e: any) {
      if (e.response) {
        throw new Error(
          `API status error: ${e.response.status} - ${e.response.data.error.message}`,
        );
      } else {
        throw new Error(`An unexpected error occurred: ${e.message}`);
      }
    }
  }

  public async handle_response(response: any): Promise<string> {
    try {
      if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        return response.completion;
      } else if (
        this.api_helper.models.mistral_models.includes(this.model_name) ||
        this.api_helper.models.gemini_models.includes(this.model_name) ||
        this.api_helper.models.grok_models.includes(this.model_name) ||
        this.api_helper.models.openai_models.includes(this.model_name)
      ) {
        return response.choices[0].message.content;
      } else {
        throw new Error(`Model ${this.model_name} is currently not supported`);
      }
    } catch (e: any) {
      throw new Error(`An unexpected error occurred: ${e.message}`);
    }
  }

  public async *handle_stream(response: any): AsyncGenerator<string, void,
  unknown> {
    try {
      if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        for await (const chunk of response) {
          if (chunk.type == "content_block_delta") {
            yield chunk.delta.text;
          }
        }
      } else if (
          this.api_helper.models.mistral_models.includes(this.model_name)
        ) {
          for await (const chunk of response) {
            const content = chunk.data.choices[0].delta.content;
            if (content) {
              yield content;
            }
          }
      } else if (
        this.api_helper.models.gemini_models.includes(this.model_name) ||
        this.api_helper.models.grok_models.includes(this.model_name) ||
        this.api_helper.models.openai_models.includes(this.model_name)
      ) {
        for await (const chunk of response) {
          const content = chunk.choices[0].delta.content;
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