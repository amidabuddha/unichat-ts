# unichat
Universal API chat Node.js client for OpenAI, MistralAI, Anthropic, xAI, Google AI, or any OpenAI SDK LLM provider.

## Build sequence:
```shell
rm -rf dist
```
```shell
npx tsc
```
```shell
npm publish
```

## Usage:

1. Install the npm package:

```shell
npm install unichat-ts
```

2. Add the class 'UnifiedChatApi' from module 'unichat' to your application:

For OpenAI-compatible providers, pass the provider endpoint as `baseURL` when constructing `UnifiedChatApi`.

3. [optional] Import MODELS_LIST as well for additional validation

## Functionality testing:
Try the eclosed in the source code 'test.js' file:

```shell
npm test
```
