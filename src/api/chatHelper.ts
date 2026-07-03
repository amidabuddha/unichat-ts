import { ClaudeRequest, InputTool, Message, Role } from '../types';
import { ApiHelper } from './apiHelper';

export class ChatHelper {
  private api_helper: ApiHelper;
  private model_name: string;
  private messages: Message[];
  private temperature: number;
  private tools: InputTool[];
  private stream: boolean;
  private cached: boolean | string;
  private reasoning_effort: boolean | string;
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
    reasoning_effort: boolean | string,
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
    this.reasoning_effort = reasoning_effort;
    this.client = client;
    this.role = role;
  }

  public async get_response() {
    try {
      if (this.api_helper.has_model("anthropic_models", this.model_name)) {
        const anthropicMessages = this.api_helper.transformMessages(this.messages);
        if (this.api_helper.anthropic_conversation.length === 0) {
          this.api_helper.anthropic_conversation.push(...anthropicMessages);
        } else if (anthropicMessages.length) {
          this.api_helper.anthropic_conversation.push(anthropicMessages[anthropicMessages.length - 1]);
        }

        const anthropicParams: ClaudeRequest = {
            model: this.model_name,
            max_tokens: this.api_helper.get_max_tokens(this.model_name),
            stream: this.stream,
        };

        if (!["claude-opus-4-8", "claude-sonnet-5"].includes(this.model_name)) {
            anthropicParams.temperature = this.reasoning_effort ? 1 : Math.min(this.temperature, 1);
        }

        if (this.tools?.length) {
            this.tools[this.tools.length - 1] = {
                ...this.tools[this.tools.length - 1],
                cache_control: { type: "ephemeral" }
            };
            anthropicParams.tools = this.tools;
        }

        if (this.cached === false) {
            anthropicParams.system = this.role;
        } else {
            anthropicParams.system = [
                { type: "text", text: this.role },
                { type: "text", text: this.cached as string, cache_control: { type: "ephemeral" } },
            ];
        }

        switch (this.reasoning_effort) {
          case "max":
          case "xhigh":
          case "high":
          case "medium":
          case "low":
            anthropicParams.thinking = { type: "adaptive", display: "summarized" };
            anthropicParams.output_config = { effort: this.reasoning_effort };
            break;
          case "none":
          case false:
            break;
          default:
            throw new Error(`Invalid reasoning_effort value: ${this.reasoning_effort}`);
        }

        anthropicParams.messages = this.api_helper.cacheMessages(this.api_helper.anthropic_conversation);

        return await this.client.messages.create(anthropicParams);

      } else {
        const params: any = {
          model: this.model_name,
          messages: this.messages,
          stream: this.stream
        };

        if (!["o1", "o3-mini", "o3", "o4-mini"].includes(this.model_name) && !this.model_name.endsWith("reasoner") && !this.model_name.startsWith("mercury")) {
          params.temperature = this.temperature;}

        if (!this.model_name.endsWith("reasoner")) {
          if (this.tools?.length) {
            params.tools = this.api_helper.transformTools(this.tools);
          }
        }

        if (this.reasoning_effort) {
          params.reasoning_effort = this.reasoning_effort;}

        return await this.client.chat.completions.create(params);
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
      if (this.api_helper.has_model("anthropic_models", this.model_name)) {
        const content = response.content
          .map((item: any) => this.api_helper.blockToDict(item))
          .filter(Boolean);
        this.api_helper.anthropic_conversation.push({
          role: Role.Assistant,
          content,
        });
        response = this.api_helper.convertClaudeToGPT(response)
      }
      return response

    } catch (e: any) {
      throw new Error(`An unexpected error occurred: ${e.message}`);
    }
  }

  public async *handle_stream(response: any){
    try {
      if (
        this.api_helper.has_model("anthropic_models", this.model_name)
      ) {
        const message: Message = { role: Role.Assistant, content: [] };
        for await (const { transformedChunk, originalBlock } of this.api_helper.transformStream(response)) {
          if (transformedChunk) {
            // console.log("DEBUG: stream: ", JSON.stringify(transformedChunk, null, 2))
            yield transformedChunk;
          }
          if (originalBlock) {
            this.api_helper.appendBlockToMessage(message, originalBlock);
          }
        }

        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
          if (block.type === "tool_use" && typeof block.input === "string") {
            try {
              block.input = JSON.parse(block.input);
            } catch {
              block.input = {};
            }
          }
        }
        this.api_helper.anthropic_conversation.push(message);
      } else {
        for await (const chunk of response) {
          // console.log("DEBUG: stream: ", JSON.stringify(chunk, null, 2))
          yield chunk;
        }
      }

    } catch (e: any) {
      throw new Error(`An unexpected error occurred: ${e.message}`);
    }
  }
}
