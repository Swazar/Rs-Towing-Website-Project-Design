import { requireWorkspaceUser } from '../lib/workspace-user.mjs';
import { permissionsFor } from '../lib/owner-access.mjs';
import { json, sameOrigin, readRecord } from '../lib/store.mjs';
import { workspaceKnowledge, websiteKnowledge } from '../lib/assistant-knowledge.mjs';
import { assistantKey, maxQuestionLength, containsPrivateDetails, validTurns, reserveAnswer, askModel } from '../lib/assistant-ai.mjs';

export const config = { rateLimit: { action: 'rate_limit', windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] } };

export function createAssistant({ authenticate = requireWorkspaceUser, keyFor = assistantKey, reserve = reserveAnswer, model = askModel, read = readRecord } = {}) {
  return async function workspaceAssistant(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    try {
      sameOrigin(request);
      const user = await authenticate(request);
      const key = keyFor(request);
      if (!key) return json({ error: 'The workspace assistant is disabled.' }, 404);
      const raw = await request.text();
      if (raw.length > 12_000) return json({ error: 'Start a new chat or enter a shorter question.' }, 413);
      let body;
      try { body = JSON.parse(raw); }
      catch { return json({ error: 'Check your question and try again.' }, 400); }
      const question = typeof body?.question === 'string' ? body.question.trim() : '';
      const turns = body?.turns ?? [];
      if (!question || question.length > maxQuestionLength || !validTurns(turns)) {
        return json({ error: 'Enter a question of up to 400 characters.' }, 400);
      }
      if (containsPrivateDetails(question)) return json({ error: 'Remove contact details or credentials before sending.' }, 400);
      if (!await reserve(user.id)) return json({ error: 'The daily AI limit was reached. Try again tomorrow.' }, 429);
      const settings = await read('settings');
      const answer = await model({
        key, question, turns: turns.filter(turn => !containsPrivateDetails(turn.question) && !containsPrivateDetails(turn.answer)),
        knowledge: workspaceKnowledge(permissionsFor(user)), website: websiteKnowledge(settings.data),
      });
      return json({ answer });
    } catch (error) {
      if ([401, 403, 429].includes(error.status)) return json({ error: error.message }, error.status);
      return json({ error: 'The assistant couldn’t reply. Try again in a moment.' }, 503);
    }
  };
}

export default createAssistant();
