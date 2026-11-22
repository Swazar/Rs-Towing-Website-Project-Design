import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createAssistant } from '../netlify/functions/workspace-assistant.mjs';
import { assistantKey, askModel, containsPrivateDetails } from '../netlify/lib/assistant-ai.mjs';
import { WorkspaceAssistant } from '../public/assets/admin-assistant.js';

const origin = 'https://towing.example';
const question = 'how do i put what the customer agreed to pay';
function request(body, source = origin) {
  return new Request(origin + '/.netlify/functions/workspace-assistant', {
    method: 'POST', headers: { Origin: source }, body: JSON.stringify(body),
  });
}

test('free chat is opt-in, keeps the provider key server-side, and never uses the old paid key', async () => {
  const endpoint = request({ question });
  assert.equal(assistantKey(endpoint, { CONTEXT: 'production', OPENAI_API_KEY: 'old-paid-key' }), '');
  assert.equal(assistantKey(endpoint, { CONTEXT: 'deploy-preview', RS_ASSISTANT_GROQ_FREE_KEY: 'test' }), '');
  assert.equal(assistantKey(endpoint, { NETLIFY_DEV: 'true', RS_ASSISTANT_GROQ_FREE_KEY: 'test' }), '');
  const authenticate = async () => ({ id: 'staff-id', roles: ['staff'] });
  const disabled = createAssistant({ authenticate, keyFor: () => '', model: () => assert.fail('never call model without free key') });
  assert.equal((await disabled(endpoint)).status, 404);
  const denied = createAssistant({ authenticate: async () => { throw Object.assign(new Error('Sign in'), { status: 401 }); } });
  assert.equal((await denied(request({ question }))).status, 401);

  let calls = 0;
  const chat = createAssistant({
    authenticate, keyFor: () => 'fake-free-key', reserve: async () => true,
    read: async () => ({ data: { businessName: 'RS on the Go', history: [{ private: 'Never sent' }] } }),
    model: async ({ key, question: input, knowledge, turns, website }) => {
      calls++;
      assert.equal(key, 'fake-free-key');
      assert.equal(input, question);
      assert.doesNotMatch(knowledge.join(' '), /Open Reviews|export the filtered|Publish changes/);
      assert.equal(website.history, undefined);
      assert.deepEqual(turns, [{ question: 'where do i open the request', answer: 'Open Enquiries.' }]);
      return 'In Notes & status, enter the Agreed price, then save.';
    },
  });
  assert.equal((await chat(request({ question: 'email person@example.com' }))).status, 400);
  assert.equal((await chat(request({ question }, 'https://other.example'))).status, 403);
  const response = await chat(request({ question, turns: [{ question: 'where do i open the request', answer: 'Open Enquiries.' }] }));
  assert.deepEqual(await response.json(), { answer: 'In Notes & status, enter the Agreed price, then save.' });
  assert.equal(calls, 1);
});

test('natural questions and follow-ups use the free chat model and unrelated answers are suppressed', async () => {
  assert.equal(containsPrivateDetails('How do I book RS-202611-TOW-0001 for 2026-11-30?'), false);
  assert.equal(containsPrivateDetails('What password is required for login?'), false);
  assert.equal(containsPrivateDetails('Call (202) 555-0100'), true);
  assert.equal(containsPrivateDetails('Call 202.555.0100'), true);
  const args = { question: 'and after?', turns: [{ question, answer: 'Open Notes & status.' }],
    knowledge: ['Enter the Agreed price and save.'], website: { business: 'RS on the Go' }, key: 'mock' };
  const reply = await askModel(args, async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(body.model, 'openai/gpt-oss-20b');
    assert.deepEqual(body.messages.slice(1).map(message => message.content), [question, 'Open Notes & status.', 'and after?']);
    assert.equal(body.tools, undefined);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ scope: 'workspace', answer: 'Enter the Agreed price and save.' }) } }] });
  });
  assert.equal(reply, 'Enter the Agreed price and save.');
  const outside = await askModel(args, async () => Response.json({
    choices: [{ message: { content: JSON.stringify({ scope: 'outside', answer: 'Do not display me' }) } }],
  }));
  assert.equal(outside, 'I can help with the RS on the Go website and admin workspace.');
  await assert.rejects(askModel(args, async () => new Response(null, { status: 429 })), { status: 429 });
});

test('chat UI hides entirely without an available free provider and clears replies on sign-out', async () => {
  const html = await readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: origin + '/admin/' });
  globalThis.document = dom.window.document;
  const savedFetch = globalThis.fetch;
  try {
    const assistant = new WorkspaceAssistant({ onExpired() {} });
    let calls = 0;
    let reply;
    globalThis.fetch = (url, options) => {
      assert.match(url, /workspace-assistant$/);
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(body.question, question);
      assert.deepEqual(body.turns, []);
      return new Promise(resolve => { reply = resolve; });
    };
    await assistant.ask(question);
    assert.equal(calls, 0);
    assert.equal(assistant.launcher.hidden, true);
    assert.equal(document.querySelectorAll('#assistant-topics, #assistant-use-ai').length, 0);
    assistant.setAvailable(true);
    const pending = assistant.ask(question);
    assert.equal(assistant.thread.querySelector('.is-user p')?.textContent, question);
    assert.equal(assistant.send.getAttribute('aria-disabled'), 'true');
    reply(Response.json({ answer: 'Use Agreed price.' }));
    await pending;
    assert.equal(assistant.launcher.hidden, false);
    assert.match(assistant.thread.textContent, /Use Agreed price/);
    assistant.setAvailable(false);
    assert.equal(assistant.thread.querySelectorAll('.assistant-message').length, 0);
  } finally {
    globalThis.fetch = savedFetch;
    delete globalThis.document;
    dom.window.close();
  }
});
