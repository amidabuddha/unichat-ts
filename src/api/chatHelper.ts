import { InputTool, Message } from '../types';
import { ApiHelper } from './apiHelper';

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
  }

  public async get_response() {
    try {
      if (this.api_helper.models.mistral_models.includes(this.model_name)) {
        const mistralParams = {
          model: this.model_name,
          temperature: this.temperature,
          messages: this.messages,
          ...(this.tools?.length ? { tools: this.api_helper.transformTools(this.tools) } : {})
        };
        if (this.stream) {
          return await this.client.chat.stream(mistralParams);
        } else {
          return await this.client.chat.complete(mistralParams);
        }
      } else if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        this.temperature = this.temperature > 1 ? 1 : this.temperature;
        const maxTokens = this.api_helper.get_max_tokens(this.model_name);
        const anthropicMessages = this.api_helper.transformMessages(this.messages)
        // console.log("DEBUG: antropic message: ", JSON.stringify(anthropicMessages, null, 2))
        const anthropicParams = {
          model: this.model_name,
          max_tokens: maxTokens,
          temperature: this.temperature,
          messages: anthropicMessages,
          stream: this.stream,
          ...(this.tools?.length ? { tools: this.tools } : {})
        };
        if (this.cached === false) {
          return await this.client.messages.create({
            ...anthropicParams,
            system: this.role,
          });
        } else {
          return await this.client.beta.promptCaching.messages.create({
            ...anthropicParams,
            system: [
                {"type": "text", "text": this.role},
                {"type": "text", "text": this.cached, "cache_control": {"type": "ephemeral"}},
            ],
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
          ...(this.tools?.length ? { tools: this.api_helper.transformTools(this.tools) } : {})
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

  public async handle_response(response: any){
    // console.log("DEBUG: response: ", JSON.stringify(response, null, 2))
    try {
      if (this.api_helper.models.anthropic_models.includes(this.model_name)) {
        response = this.api_helper.convertClaudeToGPT(response)
      }
      else if (
        this.api_helper.models.mistral_models.includes(this.model_name)
      ) {
        response = this.api_helper.transformResponse(response)
      }
      return response

    } catch (e: any) {
      throw new Error(`An unexpected error occurred: ${e.message}`);
    }
  }

  public async *handle_stream(response: any){
    try {
      if (
        this.api_helper.models.anthropic_models.includes(this.model_name)
      ) {
        response = this.api_helper.transformStream(response);
      } else if (
        this.api_helper.models.mistral_models.includes(this.model_name)
      ) {
        response = this.api_helper.transformStreamChunk(response);
      }
      for await (const chunk of response) {
        // console.log("DEBUG: stream: ", JSON.stringify(chunk, null, 2))
        yield chunk;
      }

    } catch (e: any) {
      throw new Error(`An unexpected error occurred: ${e.message}`);
    }
  }
}