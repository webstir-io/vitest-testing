# @webstir-io/vitest-testing

Vitest-powered provider for the Webstir test host. This package plugs into the host/provider architecture so `WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing` runs suites through Vitest while emitting Webstir test events.

## Status

- Experimental testing provider — behavior and integration points may change along with the core Webstir testing host.
- Intended for trying Vitest within Webstir workspaces rather than as a general-purpose, production-ready adapter.

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

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md
