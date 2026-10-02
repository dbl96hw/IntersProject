# Backend tests use node:test

## Context

Roadmap F1.1 asks to record the backend test runner. `apps/intersbackend` already runs `node --test` through `npm test`. The suite mocks the Anthropic SDK and the data engine. CI still runs lint only.

## Decision

The Express backend keeps Node's built-in test runner (`node:test`). No second runner is added for that app.

## Consequences

New backend tests stay in `apps/intersbackend/test/` and import `node:test`. They do not open the network. This record does not change the runner or the suite.

## Status

accepted
