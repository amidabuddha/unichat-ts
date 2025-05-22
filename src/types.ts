export interface ApiConfig {
    apiKey: string;
    baseUrl?: string;
}

// Chat properties
export enum Role {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
    Tool = 'tool'
}

export interface Message {
    role: Role;
    content?: string | ContentBlock[] | null;
    tool_calls?: GPTToolCall[];
    tool_call_id?: string;
}

export interface CreateCompletionOptions {
    model: string;
    messages: Message[];
    temperature?: string;
    tools?: OriginalTool[] | OutputTool[],
    stream?: boolean;
    cached?: boolean | string;
    reasoningEffort?: boolean | string;
}

// Tools transformation
export type OriginalTool = {
    name: string;
    description: string;
    inputSchema?: InputSchema;
    input_schema?: InputSchema;
}

export interface InputSchema {
    type: string;
    properties: any;
    required: string[];
    additionalProperties?: boolean;
  }

export interface InputTool {
    name: string;
    description: string;
    input_schema: InputSchema;
    cache_control?: {"type": "ephemeral"};
}

export interface OutputFunction {
    name: string;
    description: string;
    parameters: InputSchema;
}

export interface OutputTool {
    type: "function";
    function: OutputFunction;
}

// Completion transformation
type MessageType = 'message';
type AssistantRole = 'assistant';
type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

export interface BaseContent {
  type: string;
}

export interface TextContent extends BaseContent {
  type: 'text';
  text: string;
  cache_control?: {"type": "ephemeral"};
}

export interface ToolUseContent extends BaseContent {
  type: 'tool_use';
  id: string;
  name?: string;
  input: Record<string, unknown>;
  cache_control?: {"type": "ephemeral"};
}

// Anthropic specific content blocks - based on Python's block_to_dict for 'thinking'
export interface AnthropicThinkingBlock extends BaseContent {
  type: 'thinking';
  text: string; // Assuming 'thinking' block has a text field like Python's self.thinking
  // Python's block_to_dict for thinking also had 'thinking' and 'signature'
  // For now, let's keep it simple. If these are needed, they can be added.
  // thinking?: string; // Raw thinking content
  // signature?: string; // Signature if any
  cache_control?: {"type": "ephemeral"};
}

export interface AnthropicRedactedThinkingBlock extends BaseContent {
    type: 'redacted_thinking';
    // data: any; // Or specific structure if known
    cache_control?: {"type": "ephemeral"};
}

export type ContentBlock = TextContent | ToolResult | ToolUseContent | AnthropicThinkingBlock | AnthropicRedactedThinkingBlock;

export interface ClaudeUsage {
  input_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  output_tokens: number;
}

export interface ClaudeResponse {
  id: string;
  type: MessageType;
  role: AssistantRole;
  content: ContentBlock[];
  model: string;
  stop_reason: StopReason | null;
  stop_sequence: string | null;
  usage: ClaudeUsage;
}

export interface GPTFunctionCall {
  name?: string;
  arguments: string;
}

export interface GPTToolCall {
  index?: number;
  id: string;
  type?: 'function';
  function: GPTFunctionCall;
}

export interface GPTMessage {
  role: string;
  content: string | null;
  tool_calls?: GPTToolCall[];
}

export interface GPTChoice {
  index: number;
  message: GPTMessage;
  logprobs: null;
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call';
}

export interface GPTResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: GPTChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint: string;
}

// Stream transformation
export interface AnthropicMessageStart {
    type: 'message_start';
    message: {
        id: string;
        type: 'message';
        role: string;
        content: any[];
        model: string;
        stop_reason: string | null;
        stop_sequence: string | null;
        usage: {
        input_tokens: number;
        output_tokens: number;
        };
    };
}

export interface AnthropicContentBlockStart {
    type: 'content_block_start';
    index: number;
    content_block: {
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, any>;
    };
}

export interface AnthropicContentBlockDelta {
    type: 'content_block_delta';
    index: number;
    delta: {
        type: 'text_delta' | 'input_json_delta';
        text?: string;
        partial_json?: string;
    };
}

export interface AnthropicContentBlockStop {
    type: 'content_block_stop';
    index: number;
}

export interface AnthropicMessageDelta {
    type: 'message_delta';
    delta: {
        stop_reason: string;
        stop_sequence: string | null;
    };
    usage: {
        output_tokens: number;
    };
}

export type AnthropicChunk =
    | AnthropicMessageStart
    | AnthropicContentBlockStart
    | AnthropicContentBlockDelta
    | AnthropicContentBlockStop
    | AnthropicMessageDelta;

export interface OpenAIChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    system_fingerprint: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string | null;
            tool_calls?: GPTToolCall[];
            refusal?: null;
        };
        logprobs: null;
        finish_reason: string | null;
    }>;
}

// Outgoing tool transformation
export interface ToolResponse {
    role: Role;
    content: any;
    tool_call_id: string;
}

export interface ToolResult {
    type: 'tool_result';
    tool_use_id?: string; // This is the ID of the tool_use block this result corresponds to
    content: string | ContentBlock[]; // Content can be a simple string or a list of further content blocks (e.g. text)
    is_error?: boolean; // Optional: indicates if the tool execution resulted in an error
    cache_control?: {"type": "ephemeral"};
    id?: string; // Anthropic SDK sometimes includes an 'id' for tool_result blocks in responses
}

export interface TransformedResponse {
    role: Role;
    content: ToolResult[];
}

export interface ClaudeRequest {
    model: string;
    max_tokens: number;
    temperature: number;
    stream: boolean;
    tools?: InputTool[];
    system?: string | TextContent[]; // System prompt can be a string or an array containing a TextContent block
    messages?: Message[]; // Messages should be an array of Message interface compliant objects
    metadata?: { // Added based on ChatHelper usage for thinking_effort
        thinking_effort?: string;
        [key: string]: any; // Allow other metadata properties
    };
}