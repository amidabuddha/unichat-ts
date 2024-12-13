import * as readline from 'readline';
import { UnifiedChatApi } from './index';
import { MODELS_LIST } from './index';
import { Role, Message } from './index';
import process from 'process';
import { OpenAIChunk, GPTToolCall } from './types';

// Function to validate inputs
function validateInputs(apiKey: string, modelName: string): void {
  if (!apiKey) {
    throw new Error("API key cannot be empty");
  }

  const models = Object.values(MODELS_LIST).flat();
  if (!models.includes(modelName)) {
    throw new Error(`Unsupported model: ${modelName}`);
  }
}

// Function to prompt user input
function promptInput(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Calculator tool implementation
type Operation = 'add' | 'subtract' | 'multiply' | 'divide';
function calculate(operation: Operation, operand1: number, operand2: number): number {
  switch (operation) {
    case 'add':
      return operand1 + operand2;
    case 'subtract':
      return operand1 - operand2;
    case 'multiply':
      return operand1 * operand2;
    case 'divide':
      if (operand2 === 0) {
        throw new Error('Cannot divide by zero.');
      }
      return operand1 / operand2;
    default:
      throw new Error(`Unsupported operation: ${operation}`);
  }
}

function get_calculation(tool: GPTToolCall){
  const args = JSON.parse(tool.function.arguments);
  const result = calculate(
    args.operation as Operation,
    Number(args.operand1),
    Number(args.operand2)
  );

  const toolResponse: Message = {
    role: Role.Tool,
    content: result.toString(),
    tool_call_id: tool.id
  };

  return toolResponse
}

// Tool definitions
const tools = [
  {
    "name": "calculator",
    "description": "A simple calculator that performs basic arithmetic operations.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": ["add", "subtract", "multiply", "divide"],
          "description": "The arithmetic operation to perform."
        },
        "operand1": {
          "type": "number",
          "description": "The first operand."
        },
        "operand2": {
          "type": "number",
          "description": "The second operand."
        }
      },
      "required": ["operation", "operand1", "operand2"]
    }
  }
];

async function handleStreamingResponse(
  responseStream: AsyncIterable<OpenAIChunk, any, any>,
  conversation: Message[]
): Promise<void> {
  if (conversation.at(-1)?.role !== Role.Tool) {
    process.stdout.write("\nAssistant: ");
  }

  let currentContent = "";
  let currentAssistantMessage: Message = {
    role: Role.Assistant,
    content: "",
  };

  // Track existing tool calls by their ID
  const toolCallsById = new Map<string, GPTToolCall>();
  let lastToolCallIndex = -1;

  for await (const chunk of responseStream) {
    const delta = chunk.choices[0].delta;
    const finishReason = chunk.choices[0].finish_reason;

    // Handle content updates
    if (delta.content !== undefined && delta.content !== null) {
      currentContent += delta.content;
      currentAssistantMessage.content = currentContent;
      process.stdout.write(delta.content);
    }

    // Handle tool calls
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      // Initialize tool_calls array if needed
      if (!currentAssistantMessage.tool_calls) {
        currentAssistantMessage.tool_calls = [];
      }
      delta.tool_calls!.forEach((toolCall: GPTToolCall) => {
        if (toolCall.id) {
          const newToolCall: GPTToolCall = {
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function?.name || "",
              arguments: toolCall.function?.arguments || ""
            }
          };

          toolCallsById.set(toolCall.id, newToolCall);
          lastToolCallIndex = currentAssistantMessage.tool_calls!.length;
          currentAssistantMessage.tool_calls!.push(newToolCall);
        }
        else if (toolCall.function?.arguments) {
          if (lastToolCallIndex >= 0) {
            const lastToolCall = currentAssistantMessage.tool_calls![lastToolCallIndex];
            lastToolCall.function.arguments += toolCall.function.arguments;

            if (lastToolCall.id) {
              toolCallsById.set(lastToolCall.id, lastToolCall);
            }
          }
        }
      });
    }

    // Process completion of response
    if (finishReason) {
      try {
        conversation.push(currentAssistantMessage);

        // Execute each tool and add responses
        if (currentAssistantMessage.tool_calls && currentAssistantMessage.tool_calls.length > 0) {
          for (const toolCall of currentAssistantMessage.tool_calls!) {
            if (toolCall.function.name === "calculator") {
              conversation.push(get_calculation(toolCall));
            }
          }
        }
      } catch (error) {
        console.error(`Error processing function calls: ${error}`);
      }
    }
  }
}


async function handleNonStreamingResponse(
  response: any,
  conversation: Message[]
): Promise<void> {
  const assistantResponse = response.choices[0].message;
  conversation.push(assistantResponse);

  if (assistantResponse.content) {
    console.log("\nAssistant: ", assistantResponse.content);
  }

  if (assistantResponse.tool_calls) {
    for (const tool of assistantResponse.tool_calls) {
      if (tool.function.name === "calculator") {
        conversation.push(get_calculation(tool));
      }
    }
  }
}

// Main async function
async function main() {
  try {
    // Prompt for and validate inputs
    const apiKey = await promptInput("Enter your API key: ");
    const modelName = await promptInput("Enter the model name (e.g., 'gpt-4o-mini'): ");
    const streaming = !(await promptInput("Type anything to disable streaming or ENTER to continue: "));

    validateInputs(apiKey, modelName);

    // Initialize the client
    const client = new UnifiedChatApi({apiKey: apiKey});

    // Set up system message
    let system = await promptInput("Enter system instructions or leave blank for default: ");
    if (!system) {
      system = "You are a helpful assistant.";
    }

    // Initialize conversation
    const conversation: Message[] = [
      { role: Role.System, content: system }
    ];

    // Start the chat loop
    while (true) {
      try {
        // Check if we're not in the middle of a tool call
        if (conversation.at(-1)?.role !== Role.Tool) {
          const userMessage = await promptInput("\nYou: ");

          if (!userMessage) {
            continue;
          }

          if (["exit", "quit"].includes(userMessage.toLowerCase())) {
            console.log("Exiting the chat.");
            process.exit(0);
          }

          conversation.push({ role: Role.User, content: userMessage });
        }

        // Handle chat completion
        if (streaming) {
          const responseStream = await client.chat.completions.create({
            model: modelName,
            messages: conversation,
            tools: tools,
          });

          await handleStreamingResponse(responseStream, conversation);
        } else {
          const response = await client.chat.completions.create({
            model: modelName,
            messages: conversation,
            tools: tools,
            stream: false
          });

          await handleNonStreamingResponse(response, conversation);
        }
        // console.log("\nDEBUG: conversation: ", JSON.stringify(conversation, null, 2))
        console.log('\n');

      } catch (error: any) {
        console.error(`An error occurred during chat: ${error.message || error}`);
      }
    }

  } catch (error: any) {
    console.error(`Initialization error: ${error.message || error}`);
    console.log("Please try again with correct values!");
    process.exit(1);
  }
}

// Execute the main function
main();