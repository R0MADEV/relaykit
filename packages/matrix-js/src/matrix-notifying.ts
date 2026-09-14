/**
 * Being interrupted, and asking not to be.
 *
 * Push registrations, the words that wake a device, who is silenced, how loud a conversation is allowed to
 * be, and what is waiting. Apart from what a conversation *is* because none of this changes the conversation
 * — it changes what this account is told about it.
 */
import {
  PushRuleActionName,
  PushRuleKind,
  RuleId,
  TweakName,
  Method,
  type INotificationsResponse,
  type MatrixClient
} from "matrix-js-sdk";
import type { Notification, NotificationLevel, PushRegistration } from "@relaykit/core";

/**
 * How much anything at all may interrupt, for the whole account. Silence is the master rule the protocol
 * keeps for exactly this; mentions only is every rule about ordinary messages turned off, which leaves the
 * ones about being named still working.
 */
const rulesAboutOrdinaryMessages = [
  RuleId.Message,
  RuleId.EncryptedMessage,
  // A direct message is an ordinary message too: "mentions only" that still rings for every DM is not that.
  RuleId.DM,
  RuleId.EncryptedDM
];

/**
 * The homeserver never reaches a browser or a phone by itself: it hands the notification to a push gateway,
 * which is what Matrix calls a pusher. `event_id_only` keeps the message out of the gateway, so what is said
 * stays between the devices even when the notification travels through somebody else's server.
 */
/**
 * A word worth interrupting for is a content rule named after the word itself. Being named already has its own
 * rule, so this is only for the words somebody chose to care about.
 */
export async function watchForMatrixKeyword(client: MatrixClient, word: string): Promise<void> {
  await client.addPushRule("global", PushRuleKind.ContentSpecific, word, {
    pattern: word,
    actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Highlight, value: true }]
  });
  await client.getPushRules();
}
export async function stopWatchingForMatrixKeyword(client: MatrixClient, word: string): Promise<void> {
  await client.deletePushRule("global", PushRuleKind.ContentSpecific, word).catch(() => undefined);
  await client.getPushRules();
}
export async function listMatrixKeywords(client: MatrixClient): Promise<readonly string[]> {
  const rules = await client.getPushRules();
  return (
    (rules.global.content ?? [])
      // The rules the homeserver ships with start with a dot, and they are not words anybody chose.
      .filter(rule => !rule.rule_id.startsWith("."))
      .map(rule => rule.pattern ?? rule.rule_id)
  );
}
export async function registerMatrixPush(
  client: MatrixClient,
  registration: PushRegistration
): Promise<void> {
  await client.setPusher({
    pushkey: registration.deviceToken,
    kind: "http",
    app_id: registration.appId,
    app_display_name: registration.appName,
    device_display_name: registration.deviceName ?? registration.appName,
    lang: registration.language ?? "en",
    data: { url: registration.gatewayUrl, format: "event_id_only", ...registration.data },
    // Replacing rather than appending, so registering twice does not leave the old one notifying as well.
    append: false
  });
}
export async function listMatrixPushRegistrations(
  client: MatrixClient
): Promise<readonly PushRegistration[]> {
  const { pushers } = await client.getPushers();
  return pushers.map(pusher => {
    const { url, format, ...rest } = pusher.data;
    // Whatever else the homeserver keeps against this registration, kept only where it is text. The SDK
    // types those as maybe-absent, and what is handed on says every value it has is a string — so the ones
    // that are not there are dropped rather than described as strings that happen to be missing.
    const alsoKept: Record<string, string> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value === "string") alsoKept[key] = value;
    }
    return {
      gatewayUrl: url ?? "",
      deviceToken: pusher.pushkey,
      appId: pusher.app_id,
      appName: pusher.app_display_name,
      ...(pusher.device_display_name ? { deviceName: pusher.device_display_name } : {}),
      ...(pusher.lang ? { language: pusher.lang } : {}),
      ...(Object.keys(alsoKept).length > 0 ? { data: alsoKept } : {})
    };
  });
}
export async function unregisterMatrixPush(client: MatrixClient, deviceToken: string): Promise<void> {
  const { pushers } = await client.getPushers();
  const registered = pushers.find(pusher => pusher.pushkey === deviceToken);
  if (!registered) return;
  await client.removePusher(deviceToken, registered.app_id);
}
/** A person worth not being interrupted by. What they say still arrives; it just stops making a noise. */
export async function listMatrixMutedUsers(client: MatrixClient): Promise<readonly string[]> {
  const rules = await client.getPushRules();
  return (rules.global?.sender ?? [])
    .filter(rule => rule.enabled !== false && rule.actions.length === 0)
    .map(rule => rule.rule_id);
}
export async function setMatrixUserMuted(
  client: MatrixClient,
  userId: string,
  muted: boolean
): Promise<void> {
  // Deleting first either way: adding a rule that is already there would leave two saying the same thing.
  await client.deletePushRule("global", PushRuleKind.SenderSpecific, userId).catch(() => undefined);
  if (muted) {
    await client.addPushRule("global", PushRuleKind.SenderSpecific, userId, { actions: [] });
  }
  await client.getPushRules();
}
export async function getMatrixNotificationLevel(client: MatrixClient): Promise<NotificationLevel> {
  const rules = await client.getPushRules();
  const isSilent = (rules.global?.override ?? []).some(
    rule => rule.rule_id === RuleId.Master && rule.enabled
  );
  if (isSilent) return "none";
  const underlying = rules.global?.underride ?? [];
  const ordinaryMessagesAreOff = rulesAboutOrdinaryMessages.every(ruleId => {
    const rule = underlying.find(candidate => candidate.rule_id === ruleId);
    return rule !== undefined && rule.enabled === false;
  });
  return ordinaryMessagesAreOff ? "mentions" : "all";
}
export async function setMatrixNotificationLevel(
  client: MatrixClient,
  level: NotificationLevel
): Promise<void> {
  await client.setPushRuleEnabled("global", PushRuleKind.Override, RuleId.Master, level === "none");
  for (const ruleId of rulesAboutOrdinaryMessages) {
    await client
      .setPushRuleEnabled("global", PushRuleKind.Underride, ruleId, level === "all")
      .catch(() => undefined);
  }
  // What this client holds is refreshed by sync, which has not happened yet: asking updates it now, so reading
  // back gives the decision just taken and not the one before it.
  await client.getPushRules();
}
/**
 * What the homeserver is holding for this account. An application that was closed has no events to work it
 * out from, so it asks. A highlight is the protocol saying this one names the person, which deserves more.
 */
export async function listMatrixPending(
  client: MatrixClient,
  limit: number
): Promise<readonly Notification[]> {
  // The SDK only reaches this endpoint through its notification timeline, which asks for highlights alone.
  // What a cold start has to show is everything waiting, so it is asked for directly.
  const response = await client.http.authedRequest<INotificationsResponse>(Method.Get, "/notifications", {
    limit: String(limit)
  });
  return (response.notifications ?? []).map(waiting => ({
    conversationId: waiting.room_id,
    messageId: waiting.event.event_id,
    senderId: waiting.event.sender,
    body: typeof waiting.event.content?.body === "string" ? waiting.event.content.body : "",
    isMention: waiting.actions.some(action => isHighlight(action))
  }));
}
/** The protocol says a message names somebody by tweaking "highlight" on, which is not a plain string action. */
function isHighlight(action: unknown): boolean {
  if (typeof action !== "object" || action === null) return false;
  const tweak = action as { set_tweak?: unknown; value?: unknown };
  return tweak.set_tweak === "highlight" && tweak.value !== false;
}
