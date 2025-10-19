
import { db } from "@/db/client";
import { actions } from "@/db/schema";

type ActionKind = "keep" | "opt_out" | "rts";

export async function routeAction(input: {
  decisionId: number;
  type: ActionKind;
  endpoint?: string;
  payload?: any;
}) {
  db.insert(actions).values({
    decisionId: input.decisionId,
    type: input.type === "opt_out" ? "web_form" : input.type,
    endpoint: input.endpoint ?? null,
    payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    status: "pending"
  }).run();

  return { ok: true };
}
