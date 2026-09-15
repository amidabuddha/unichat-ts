# unichat
Universal API chat Node.js client for OpenAI, MistralAI, Anthropic, xAI, Google AI, or any OpenAI SDK LLM provider.

## Clean installation from source

Install Git, Node.js and npm. The publishing workflow uses Node.js 24; use that version to match CI. The package does not declare a minimum Node.js version in `package.json`. Install development dependencies too, because the build uses the local TypeScript compiler.

For a fresh checkout:

```shell
git clone https://github.com/amidabuddha/unichat-ts.git
cd unichat-ts
npm ci
npm run build
npm test
```

For an existing checkout whose dependency folders or build output were removed, enter its repository root and run the same commands starting with `npm ci`.

`npm ci` restores dependencies from `package-lock.json` and replaces `node_modules/` itself. Keep the lockfile. There is no `prepare` script, so installation does not build this package. `npm run build` compiles `src/` into JavaScript and TypeScript declarations in `dist/`.

The build and regression tests require no API keys or environment-variable setup. To try the interactive example after building:

```shell
npm run demo
```

The demo runs `dist/test.js` (compiled from `src/test.ts`) and prompts for your provider API key, model name and chat options. It makes live API requests. It does not load `.env` files; enter your key at the prompt and keep secrets out of source control. Type `exit` or `quit` at the chat prompt to stop.

## Normal development

Run these commands from the repository root after installing dependencies:

```shell
npm run build
npm test
```

`npm test` runs `npm run build` followed by `node dist/regression.test.js`. These regression tests use fake clients and placeholder keys, without live API requests. If you only need to build and test, `npm test` performs both steps.

For automatic recompilation while editing, pass TypeScript's watch flag through the build script:

```shell
npm run build -- --watch
```

In another terminal at the repository root, use `npm run demo` to run the compiled example. Watch mode recompiles files but does not restart the demo; restart it to load changes. There is no separate `dev` or `start` script.

Ordinary source changes normally need only a rebuild or watch recompilation. You do not need to delete dependencies or clean all output each time. The compiler configuration does not enable persistent incremental build caching.

## Clean rebuild of an existing checkout

Run from the repository root:

```shell
rm -rf dist
npm ci
npm run build
```

`dist/` is the generated output directory declared in `tsconfig.json` and is ignored by Git. Removing it also clears stale compiled files left after source files are renamed or deleted. `npm ci` replaces `node_modules/` with the locked dependencies; no separate dependency-folder deletion is needed. If dependencies are already intact and match the lockfile, skip `npm ci` for an output-only rebuild.

Optionally run `npm test` afterward to rebuild and run the regression tests. Preserve `src/`, configuration, `.env` files, user data and `package-lock.json`. Do not use `git clean` or clear global npm caches or toolchains for this workflow.

## Usage:

1. Install the npm package:

```shell
npm install unichat-ts
```

2. Import `UnifiedChatApi` from `unichat-ts` in your application:

```typescript
import { UnifiedChatApi } from 'unichat-ts';
```

For OpenAI-compatible providers, pass the provider endpoint as `baseURL` when constructing `UnifiedChatApi`.

3. [optional] Import MODELS_LIST as well for additional validation

## Publishing (maintainers only)

Publishing is a separate release operation and is not part of installing, developing or rebuilding locally. After preparing the intended package version, restoring dependencies and running `npm test`, maintainers with npm publishing access can publish the built package with:

```shell
npm publish
```

The existing GitHub Actions workflow also builds and publishes an unpublished package version when `package.json` changes on `main`, or when manually dispatched. See [the publishing workflow](.github/workflows/publish.yml).
