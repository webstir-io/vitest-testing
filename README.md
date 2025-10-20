# @webstir-io/vitest-testing

Vitest-powered provider for the Webstir test host. This package plugs into the host/provider architecture so `WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing` runs suites through Vitest while emitting Webstir test events.

## Usage

```bash
npm install --save-dev @webstir-io/vitest-testing
WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing webstir test
```

### Local development

```bash
npm install
npm run build
```

If you are testing unpublished changes against the Webstir CLI, set `WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing` and point `WEBSTIR_TESTING_PROVIDER_SPEC` at your local checkout of this repository.

The compiled JavaScript is emitted to `dist/` alongside the generated type definitions.
