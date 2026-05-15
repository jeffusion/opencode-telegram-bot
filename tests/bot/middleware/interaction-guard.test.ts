import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";
import { interactionGuardMiddleware } from "../../../src/bot/middleware/interaction-guard.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { foregroundSessionState } from "../../../src/app/managers/foreground-session-state-manager.js";
import { t } from "../../../src/i18n/index.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { MAX_QUEUED_PROMPTS } from "../../../src/app/managers/prompt-queue-manager.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import { setIncomingPrompt } from "../../../src/bot/handlers/rich-message-handler.js";

const mocked = vi.hoisted(() => ({
  reconcileForegroundBusyStateMock: vi.fn(),
  getPromptQueueEnabled: vi.fn(),
}));

vi.mock("../../../src/app/services/run-control-service.js", () => ({
  reconcileForegroundBusyState: mocked.reconcileForegroundBusyStateMock,
}));

vi.mock("../../../src/app/stores/settings-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/app/stores/settings-store.js")>();
  return {
    ...actual,
    getPromptQueueEnabled: mocked.getPromptQueueEnabled,
  };
});

function createTextContext(text: string): Context {
  return {
    chat: { id: 1 },
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createCallbackContext(data: string): Context {
  return {
    callbackQuery: { data } as Context["callbackQuery"],
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("interactionGuardMiddleware", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    foregroundSessionState.__resetForTests();
    mocked.reconcileForegroundBusyStateMock.mockReset();
    mocked.reconcileForegroundBusyStateMock.mockResolvedValue(undefined);
    mocked.getPromptQueueEnabled.mockReset().mockReturnValue(false);
    promptQueue.__resetForTests();
  });

  it("passes through when there is no active interaction", async () => {
    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("blocks text and replies when callback is expected", async () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
    });

    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("inline.blocked.expected_choice"));
  });

  it("blocks callback and answers callback query when text is expected", async () => {
    interactionManager.start({
      kind: "task",
      expectedInput: "text",
    });

    const ctx = createCallbackContext("project:123");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("task.blocked.expected_input"),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("allows command from allowed list", async () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/status");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("always allows /start even when command list is restricted", async () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/start");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("blocks disallowed command", async () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/help");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("inline.blocked.command_not_allowed"));
  });

  it("shows permission-specific message for blocked text", async () => {
    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
    });

    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("permission.blocked.expected_reply"));
  });

  it("shows permission-specific message for disallowed command", async () => {
    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/new");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("permission.blocked.command_not_allowed"));
  });

  it("shows question-specific message for blocked text", async () => {
    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
    });

    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("question.blocked.expected_answer"));
  });

  it("shows question-specific message for disallowed command", async () => {
    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/new");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("question.blocked.command_not_allowed"));
  });

  it("allows task cancel callback while text is expected", async () => {
    interactionManager.start({
      kind: "task",
      expectedInput: "text",
    });

    const ctx = createCallbackContext("task:cancel");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("shows task-specific message for disallowed command", async () => {
    interactionManager.start({
      kind: "task",
      expectedInput: "text",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/new");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("task.blocked.command_not_allowed"));
  });

  it("blocks disallowed command while busy with generic blocked message", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createTextContext("/new");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_busy"));
  });

  it("blocks plain text while busy and suggests the queue when it is disabled", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      `${t("bot.session_busy")} ${t("queue.disabled_hint")}`,
    );
  });

  it("does not suggest the queue for a reply keyboard button pressed while busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createTextContext("🧠 openrouter\nopenai/gpt-4o");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_busy"));
  });

  it("passes through after on-demand reconciliation clears stale busy state", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    mocked.reconcileForegroundBusyStateMock.mockImplementationOnce(async () => {
      foregroundSessionState.markIdle("session-1");
    });

    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(mocked.reconcileForegroundBusyStateMock).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("keeps blocking after on-demand reconciliation leaves state busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(mocked.reconcileForegroundBusyStateMock).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining(t("bot.session_busy")));
  });

  it("blocks callback while busy without active question or permission", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCallbackContext("project:123");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("bot.session_busy"),
    });
  });

  it("allows abort, detach, status, help, and opencode_stop while busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    for (const command of ["/abort", "/detach", "/status", "/help", "/opencode_stop"]) {
      const ctx = createTextContext(command);
      const next: NextFunction = vi.fn().mockResolvedValue(undefined);

      await interactionGuardMiddleware(ctx, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(ctx.reply).not.toHaveBeenCalled();
    }
  });

  it("allows active question callback while busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "question",
      expectedInput: "mixed",
    });

    const ctx = createCallbackContext("question:select:0:1");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("allows active permission callback while busy", async () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
    });

    const ctx = createCallbackContext("permission:allow:1");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("queues a photo-only rich prompt while busy without downloading", async () => {
    mocked.getPromptQueueEnabled.mockReturnValue(true);
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    const ctx = createTextContext("");
    setIncomingPrompt(
      ctx,
      createIncomingPrompt("", {
        photos: [{ fileId: "photo-1", filename: "rich.jpg", source: "rich" }],
      }),
    );
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(promptQueue.list()).toEqual([
      expect.objectContaining({
        text: "",
        photos: [{ fileId: "photo-1", filename: "rich.jpg", source: "rich" }],
      }),
    ]);
    expect(ctx.reply).toHaveBeenCalledWith(
      t("queue.added", { count: "1", max: String(MAX_QUEUED_PROMPTS) }),
      expect.anything(),
    );
  });

  it("rejects a rich prompt when the queue is full", async () => {
    mocked.getPromptQueueEnabled.mockReturnValue(true);
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      promptQueue.add(createIncomingPrompt(`queued ${index}`));
    }
    const ctx = createTextContext("overflow");
    setIncomingPrompt(ctx, createIncomingPrompt("overflow"));
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(promptQueue.size()).toBe(MAX_QUEUED_PROMPTS);
    expect(ctx.reply).toHaveBeenCalledWith(
      t("queue.full", { max: String(MAX_QUEUED_PROMPTS) }),
      expect.anything(),
    );
  });
});
