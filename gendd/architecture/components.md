# Components

## Express gateway (`apps/intersbackend`)

The HTTP API the frontend calls. It stores chats and reviews, sends tables to `POST /ingest/records`
and documents to `POST /documents/base64`, and asks Claude only for justifications (`explainAll`).
It does not decide colours, verdicts or evidence. The breeder decides pass or no pass.

Conventions and tests: `context/backend-development.md`. Contract: `docs/api-contract.md`.
