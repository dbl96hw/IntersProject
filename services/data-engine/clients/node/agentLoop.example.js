// Example: Claude tool-use loop backed by the data engine (copy and adapt).
//
//   npm install @anthropic-ai/sdk          (in apps/intersbackend)
//   ANTHROPIC_API_KEY=...  ANTHROPIC_MODEL=<model id>  DATA_ENGINE_URL=http://localhost:8001
//
// Flow: the engine provides the tool definitions and the system prompt (GET /tools),
// Claude decides which tools to call, the engine executes them (POST /tools/:name),
// and Claude writes the answer citing only the values the tools returned.

import Anthropic from '@anthropic-ai/sdk';
import { MAX_TOOL_ROUNDS } from './constants.js';
import { createDataEngineClient } from './dataEngineClient.js';

const anthropic = new Anthropic();
const engine = createDataEngineClient();

export async function askBreedersDesk(question, history = []) {
  const { tools, system_prompt: systemPrompt } = await engine.getTools();
  const messages = [...history, { role: 'user', content: question }];
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((block) => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const answer = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
      return { answer, toolCalls, usage: response.usage };
    }

    const results = await Promise.all(toolUses.map(async (use) => {
      const { content } = await engine.runTool(use.name, use.input);
      toolCalls.push({ name: use.name, input: use.input });
      return { type: 'tool_result', tool_use_id: use.id, content };
    }));
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'I could not complete the answer within the tool budget. Please narrow the question.', toolCalls };
}
