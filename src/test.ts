import * as readline from 'readline';
import { UnifiedChatApi } from './index';
import { MODELS_LIST } from './index';
import { Role } from './index';
import process from 'process';



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

// Main async function
async function main() {
  try {
    // Prompt the user for necessary inputs
    const apiKey = await promptInput("Enter your API key: ");
    const modelName = await promptInput("Enter the model name (e.g., 'gpt-4o-mini'): ");
    let streaming: string | boolean = await promptInput("Type anything to disable streaming or ENTER to continue: ")
    if (!streaming) {
      streaming = true;
    }

    // Validate inputs
    validateInputs(apiKey, modelName);

    // Initialize the client
    const client = new UnifiedChatApi(apiKey);

    // Prompt for system instructions
    let system = await promptInput("Enter system instructions or leave blank for default: ");
    if (!system) {
      system = "You are a helpful assistant.";
    }

    // Initialize the conversation
    const conversation: any[] = [];
    conversation.push({ role: Role.System, content: system });

    // Start the chat loop
    while (true) {
      // Prompt for user message
      const userMessage = await promptInput("\nYou: ");
      if (!userMessage) {
        continue;
      }

      if (["exit", "quit"].includes(userMessage.toLowerCase())) {
        console.log("Exiting the chat.");
        process.exit(0);
      }

      // Add user's message to conversation
      conversation.push({ role: Role.User, content: userMessage });

      try {
        let assistantResponse = "";
        if (streaming === true) {
          // Call the chat completion API with streaming
          process.stdout.write("\nAssistant: ");

          for await (const chunk of await client.chat.completions.create({
            model: modelName,
            messages: conversation
          })) {
            assistantResponse += chunk;
            process.stdout.write(chunk);
          }
        } else {
          // Call the chat completion API with streaming
          let assistantResponse = await client.chat.completions.create({
            model: modelName,
            messages: conversation,
            stream: false
          });
          console.log(assistantResponse)
        };

        console.log(); // Move to the next line after assistant finishes
        // Add assistant's response to conversation
        conversation.push({ role: Role.Assistant, content: assistantResponse });
      } catch (error: any) {
        console.error(`An error occurred: ${error.message || error}`);
      }
    }

  } catch (error: any) {
    console.error(error.message || error);
    console.log("Please try again with correct values!");
    process.exit(1);
  }
}

// Execute the main function
main();