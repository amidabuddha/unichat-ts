import { CreateCompletionOptions } from '../types';
import { ApiHelper } from './apiHelper';
import { ChatHelper } from './chatHelper';

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



