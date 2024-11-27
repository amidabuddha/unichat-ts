import { UnifiedChatApi } from './unichat';

(async () => {
  const apiKey = 'your-api-key';
  const api = new UnifiedChatApi(apiKey);
  // Change to true to test streaming
  const streaming = false;
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.'},
    { role: 'user', content: 'Hello!' }
  ];

  try {
    const response = await api.chat.completions.create('gpt-3.5-turbo', messages, '1.0', streaming);
    console.log(response);
  } catch (error) {
    console.error(error);
  }
})();