import { action } from '@elgato/streamdeck';
import { actionUuid } from './identity.js';
import { UsageAction } from './runtime/actions.js';
import { initializeStore } from './runtime/store.js';
import streamDeck from '@elgato/streamdeck';

@action({ UUID: actionUuid('openai-short') })
class OpenAIShort extends UsageAction {
  constructor() {
    super('openai', 'short');
  }
}

@action({ UUID: actionUuid('openai-weekly') })
class OpenAIWeekly extends UsageAction {
  constructor() {
    super('openai', 'weekly');
  }
}

@action({ UUID: actionUuid('anthropic-short') })
class AnthropicShort extends UsageAction {
  constructor() {
    super('anthropic', 'short');
  }
}

@action({ UUID: actionUuid('anthropic-weekly') })
class AnthropicWeekly extends UsageAction {
  constructor() {
    super('anthropic', 'weekly');
  }
}

@action({ UUID: actionUuid('grok-weekly') })
class GrokWeekly extends UsageAction {
  constructor() {
    super('grok', 'weekly');
  }
}

@action({ UUID: actionUuid('cursor-monthly') })
class CursorMonthly extends UsageAction {
  constructor() {
    super('cursor', 'monthly');
  }
}

@action({ UUID: actionUuid('supergrok-weekly') })
class SuperGrokWeekly extends UsageAction {
  constructor() {
    super('supergrok', 'weekly');
  }
}

for (const instance of [
  new OpenAIShort(),
  new OpenAIWeekly(),
  new AnthropicShort(),
  new AnthropicWeekly(),
  new GrokWeekly(),
  new CursorMonthly(),
  new SuperGrokWeekly()
])
  streamDeck.actions.registerAction(instance);

void streamDeck.connect().then(initializeStore);
