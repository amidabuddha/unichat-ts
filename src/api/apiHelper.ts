import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { Mistral } from '@mistralai/mistralai';

import { MODELS_LIST, MODELS_MAX_TOKEN } from "../models";

export class ApiHelper {
    private api_key: string;
    public readonly models: any;
    private max_tokens: any;
    private api_client: any;
    private static DEFAULT_MAX_TOKENS: number = 4096;

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
          apiKey: this.api_key,
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