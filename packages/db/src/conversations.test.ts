import { describe, expect, it } from "vitest";
import { projectConversations } from "./conversations.js";
import { createNodeDriver } from "./node.js";
import { createRepository } from "./repository.js";

describe("conversations", () => {
  it("are read from the event log, survive rebuild, and drop orphan or duplicate messages", async () => {
    const repo = await createRepository(await createNodeDriver());
    await repo.append({
      type: "ConversationStarted",
      conversationId: "c1",
      lang: "nl",
      topic: "koffie",
      targetWords: ["gezellig"],
    });
    await repo.append({
      type: "MessageAdded",
      conversationId: "c1",
      messageId: "m1",
      role: "assistant",
      text: "Hoi",
      meta: { coverage: 0.97 },
    });
    await repo.append({
      type: "MessageAdded",
      conversationId: "c1",
      messageId: "m1",
      role: "assistant",
      text: "dup",
    });
    await repo.append({
      type: "MessageAdded",
      conversationId: "ghost",
      messageId: "m2",
      role: "user",
      text: "x",
    });
    await repo.append({ type: "SettingChanged", key: "a", value: 1 });
    await repo.rebuild();
    const convs = projectConversations(await repo.conversationEvents());
    expect(convs).toHaveLength(1);
    expect(convs[0]!.topic).toBe("koffie");
    expect(convs[0]!.messages).toEqual([
      { id: "m1", role: "assistant", text: "Hoi", meta: { coverage: 0.97 } },
    ]);
    await repo.close();
  });
});
