import { createHash } from "node:crypto";
import { config } from "./config.js";
import { rateLimiter } from "./web/http.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 60_000;

export const aiEnabled = () => Boolean(config.openaiApiKey);

// Thrown when a customer, or the business as a whole, has used its AI allowance. Callers fall back
// to built-in answers; on the website it becomes a 429 with this message.
export class AiLimitError extends Error {
  constructor(message) {
    super(message);
    this.status = 429;
  }
}

const AI_CALLS_PER_USER_PER_HOUR = 20;
const perUser = rateLimiter({ windowMs: 60 * 60_000, max: AI_CALLS_PER_USER_PER_HOUR });
const daily = { date: "", used: 0 };

function spendAiCall(userId) {
  const date = new Date().toISOString().slice(0, 10);
  if (daily.date !== date) Object.assign(daily, { date, used: 0 });
  if (daily.used >= config.aiDailyLimit) throw new AiLimitError("Our AI assistant is busy right now. Please try again later or message us.");
  if (!perUser.hit(String(userId))) throw new AiLimitError("You've reached the AI limit for now. Please try again in an hour or message us.");
  daily.used++;
}

// The REST API returns text inside output[].content[]; output_text is an SDK-only convenience.
export function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}

async function createResponse(userId, { system, user, format }) {
  if (!aiEnabled()) throw new Error("OPENAI_API_KEY is not set.");
  spendAiCall(userId);
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: config.openaiModel,
      reasoning: { effort: "low" },
      text: { format, verbosity: "low" },
      safety_identifier: createHash("sha256").update(String(userId)).digest("hex").slice(0, 32),
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = await response.json();
  const text = outputText(data);
  if (!text) throw new Error(`OpenAI returned no text (status: ${data.status ?? "unknown"})`);
  return text;
}

export async function requestJson(userId, { system, user, name, schema }) {
  return JSON.parse(await createResponse(userId, { system, user, format: { type: "json_schema", name, strict: true, schema } }));
}

export function requestText(userId, { system, user }) {
  return createResponse(userId, { system, user, format: { type: "text" } });
}
