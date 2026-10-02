# Frontend tests use Vitest and Testing Library

## Context

The frontend had no test script. Roadmap F1.2 asks for a recorded choice before the dashboard is wired. The app is React on Vite. Tests must render loading, empty and error states and must not call the network.

## Decision

Frontend tests use Vitest with jsdom and React Testing Library. Fetch is replaced in the test. End-to-end browser tests stay out of this decision.

## Consequences

`apps/intersfrontend` gains a `test` script and those dev dependencies. A test asserts what the screen shows, not a private helper. Playwright is not added here.

## Status

accepted
