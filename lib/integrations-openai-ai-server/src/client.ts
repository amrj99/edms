import OpenAI from "openai";

let _client: OpenAI | null = null;

function createClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  if (!baseURL || !apiKey) {
    throw new Error(
      "AI provider not configured. Set AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY, " +
        "or configure an alternative AI provider (Groq, Ollama) in the AI Settings dashboard.",
    );
  }

  return new OpenAI({ apiKey, baseURL });
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    if (_client === null) {
      _client = createClient();
    }
    const value = Reflect.get(_client, prop, receiver);
    return typeof value === "function" ? value.bind(_client) : value;
  },
});
