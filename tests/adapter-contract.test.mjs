import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { InMemoryAdapter } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

/**
 * One suite that every MessagingAdapter must satisfy. It runs against the in-memory adapter always and
 * against the Matrix adapter when RELAYKIT_CONTRACT_MATRIX=1 and a homeserver is reachable.
 */

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const matrixUser = process.env.MATRIX_USER_A ?? "alice";
const matrixPassword = process.env.MATRIX_PASSWORD_A ?? "alice-password";

async function inMemorySetup() {
  const adapter = new InMemoryAdapter();
  // A real session always carries a device, so the double is given one too.
  await adapter.start({ homeserver: "memory://test", userId: "alice", accessToken: "token", deviceId: "ALICE-1" }, {});
  return { adapter, participant: "bob", cleanup: () => adapter.stop() };
}

async function matrixSetup() {
  const adapter = new MatrixJsAdapter();
  const session = await adapter.login({
    homeserver,
    username: matrixUser,
    password: matrixPassword,
    deviceName: "RelayKit contract"
  });
  await adapter.start(session, {});
  return { adapter, participant: `@${process.env.MATRIX_USER_B ?? "bob"}:localhost`, cleanup: () => adapter.logout() };
}

async function waitFor(description, check, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function runContract(name, setup) {
  describe(`adapter contract: ${name}`, () => {
    // An alias belongs to a server, and the two adapters do not live on the same one.
    const homeserverName = name === "matrix" ? "localhost" : "memory";
    let adapter;
    let participant;
    let cleanup;
    let conversationId;

    before(async () => {
      ({ adapter, participant, cleanup } = await setup());
      // Unencrypted so the contract covers adapter behaviour, not the crypto pipeline the smokes already cover.
      const conversation = await adapter.createConversation({
        participantIds: [participant],
        title: "RelayKit contract",
        encrypted: false
      });
      conversationId = conversation.id;
      assert.equal(typeof conversation.id, "string");
      assert.ok(conversation.id.length > 0);
    });

    after(async () => {
      await cleanup?.();
    });

    it("reports the participant it invited as not having accepted yet", async () => {
      // The invitation reaches the conversation through sync, not the moment it is sent.
      const listed = await waitFor("the invited participant to appear", async () => {
        const conversations = await adapter.listConversations();
        const current = conversations.find(item => item.id === conversationId);
        return current?.participantIds.includes(participant) ? current : undefined;
      });

      assert.ok(listed.invitedIds.includes(participant), "the invited participant has not joined yet");
    });

    it("lists the conversation it just created", async () => {
      const conversations = await waitFor("the conversation to be listed", async () => {
        const listed = await adapter.listConversations();
        return listed.find(item => item.id === conversationId);
      });
      assert.equal(conversations.id, conversationId);
    });

    it("sends a message that keeps its transaction id and appears in the timeline", async () => {
      const body = `contract-${Date.now()}`;
      const transactionId = `txn-${Date.now()}`;

      const sent = await adapter.sendMessage(conversationId, body, { transactionId });

      assert.equal(sent.body, body);
      assert.equal(sent.status, "sent");
      assert.equal(sent.transactionId, transactionId);
      assert.equal(sent.conversationId, conversationId);
      assert.equal(typeof sent.createdAt, "number");
      const messages = await waitFor("the message to reach the timeline", async () => {
        const listed = await adapter.listMessages(conversationId);
        return listed.find(message => message.id === sent.id);
      });
      assert.equal(messages.body, body);
    });

    it("does not duplicate a message when the same transaction id is sent twice", async () => {
      const body = `idempotent-${Date.now()}`;
      const transactionId = `txn-idempotent-${Date.now()}`;

      const first = await adapter.sendMessage(conversationId, body, { transactionId });
      const second = await adapter.sendMessage(conversationId, body, { transactionId });

      assert.equal(second.id, first.id);
      const listed = await adapter.listMessages(conversationId);
      assert.equal(listed.filter(message => message.body === body).length, 1);
    });

    it("returns a page with the timeline and whether older history remains", async () => {
      const page = await adapter.loadMoreMessages(conversationId, 10);

      assert.equal(typeof page.hasMore, "boolean");
      assert.ok(Array.isArray(page.messages));
      assert.ok(page.messages.every(message => message.conversationId === conversationId));
    });

    it("uploads an attachment and downloads back the same bytes", async () => {
      const data = new Uint8Array(64).map((_, index) => index * 3 % 256);
      const progress = [];

      const sent = await adapter.sendAttachment(
        conversationId,
        { name: "contract.bin", mimeType: "application/octet-stream", data },
        `txn-file-${Date.now()}`,
        fraction => progress.push(fraction)
      );

      assert.equal(sent.attachment.name, "contract.bin");
      assert.ok(sent.attachment.source.length > 0);
      assert.equal(progress.at(-1), 1);
      assert.deepEqual(await adapter.downloadAttachment(sent.attachment), data);
    });

    it("uploads a thumbnail that can be downloaded on its own", async () => {
      const data = new Uint8Array(64).map((_, index) => index % 251);
      const thumbnailData = new Uint8Array([1, 2, 3, 4, 5, 6]);

      const sent = await adapter.sendAttachment(
        conversationId,
        { name: "foto.jpg", mimeType: "image/jpeg", data, width: 800, height: 600, thumbnail: { mimeType: "image/jpeg", data: thumbnailData, width: 80, height: 60 } },
        `txn-thumb-${Date.now()}`
      );

      const { thumbnail } = sent.attachment;
      assert.equal(thumbnail.mimeType, "image/jpeg");
      assert.equal(thumbnail.width, 80);
      assert.deepEqual(await adapter.downloadAttachment(thumbnail), thumbnailData);
      assert.deepEqual(await adapter.downloadAttachment(sent.attachment), data);
    });

    it("sends a voice note that is told apart from an audio file", async () => {
      const data = new Uint8Array([79, 103, 103, 83, 0, 2, 0, 0]);

      const sent = await adapter.sendAttachment(
        conversationId,
        { name: "nota.ogg", mimeType: "audio/ogg", data, voice: { durationMs: 3200, waveform: [0, 512, 1024] } },
        `txn-voice-${Date.now()}`
      );

      const readBack = await waitFor("the voice note to reach the timeline", async () => {
        const listed = await adapter.listMessages(conversationId);
        return listed.find(message => message.id === sent.id);
      });
      assert.equal(readBack.attachment.voice.durationMs, 3200);
      assert.deepEqual(await adapter.downloadAttachment(readBack.attachment), data);
    });

    it("sends a place that arrives as a place and not as a line of text", async () => {
      const sent = await adapter.sendMessage(conversationId, "Bilbao", {
        transactionId: `txn-place-${Date.now()}`,
        location: { latitude: 43.263, longitude: -2.935, description: "Bilbao" }
      });

      const readBack = await waitFor("the place to reach the timeline", async () => {
        const listed = await adapter.listMessages(conversationId);
        return listed.find(message => message.id === sent.id);
      });
      assert.equal(readBack.location.latitude, 43.263);
      assert.equal(readBack.location.longitude, -2.935);
      assert.equal(readBack.location.description, "Bilbao");
    });

    it("edits and deletes a message", async () => {
      const sent = await adapter.sendMessage(conversationId, `editable-${Date.now()}`, { transactionId: `txn-edit-${Date.now()}` });

      const edited = await adapter.editMessage(conversationId, sent.id, "editado");
      assert.equal(edited.body, "editado");
      assert.equal(typeof edited.editedAt, "number");

      const deleted = await adapter.deleteMessage(conversationId, sent.id);
      assert.equal(deleted.body, "");
      assert.equal(typeof deleted.deletedAt, "number");
    });

    it("resolves a profile for the current user and for an unknown one", async () => {
      const ownUserId = name === "in-memory" ? "alice" : `@${matrixUser}:localhost`;

      const own = await adapter.getProfile(ownUserId);
      const unknown = await adapter.getProfile("@nobody-here-at-all:localhost");

      assert.equal(own.id, ownUserId);
      assert.equal(unknown.id, "@nobody-here-at-all:localhost");
      assert.equal(unknown.displayName, undefined);
      assert.equal(await adapter.getAvatar("@nobody-here-at-all:localhost"), undefined);
    });

    it("tells where somebody is while they move, and stops telling when stopped", async () => {
      const sharing = await adapter.startLiveLocation(conversationId, {
        durationMs: 600000,
        description: `on my way ${Date.now()}`
      });
      assert.equal(sharing.isLive, true);
      assert.ok(sharing.durationMs > 0);

      await adapter.updateLiveLocation(sharing.id, { latitude: 43.26, longitude: -2.93 });
      const telling = await waitFor("the position", async () => {
        const listed = await adapter.listLiveLocations(conversationId);
        return listed.find(item => item.id === sharing.id && item.lastPosition);
      });
      assert.equal(Math.round(telling.lastPosition.latitude * 100), 4326);

      await adapter.stopLiveLocation(sharing.id);
      const stopped = await waitFor("the end", async () => {
        const listed = await adapter.listLiveLocations(conversationId);
        const current = listed.find(item => item.id === sharing.id);
        return current && !current.isLive ? current : undefined;
      });
      assert.equal(stopped.isLive, false);
    });

    it("asks the conversation something, counts the votes and closes it", async () => {
      const poll = await adapter.startPoll(conversationId, {
        question: `What time do we eat? ${Date.now()}`,
        answers: ["At two", "At three"],
        maxSelections: 1
      });
      assert.equal(poll.answers.length, 2);
      assert.equal(poll.isClosed, false);

      // If `startPoll` gives back a poll, that poll exists: listing right after has to find it. Without
      // this, whoever asks something and paints the list sees that nothing happened.
      const listedStraightAway = await adapter.listPolls(conversationId);
      assert.ok(
        listedStraightAway.some(item => item.id === poll.id),
        "the poll was not there when listing right after creating it"
      );

      // Voting and the vote counting are not two different moments for the caller either: if `voteInPoll`
      // comes back, the vote is there. Waiting here would hide that the application paints an unchanged tally.
      await adapter.voteInPoll(conversationId, poll.id, poll.answers[1].id);
      const voted = (await adapter.listPolls(conversationId)).find(item => item.id === poll.id);
      assert.equal(
        voted.answers.find(answer => answer.id === poll.answers[1].id).votes, 1,
        "the vote did not count when listing right after voting"
      );
      assert.equal(voted.answers.find(answer => answer.id === poll.answers[0].id).votes, 0);

      await adapter.closePoll(conversationId, poll.id);
      const closed = (await adapter.listPolls(conversationId)).find(item => item.id === poll.id);
      assert.equal(closed.isClosed, true, "the poll was not closed when listing right after closing it");
    });

    it("previews a link by asking the homeserver", async () => {
      // An address the homeserver can really reach without going out to the internet: the environment's own
      // gateway. What it answers depends on the page; what is required is that it answers something coherent.
      const url = name === "in-memory"
        ? "https://ejemplo.test/articulo"
        : "http://push-gateway:8080/received";

      const preview = await adapter.previewLink(url);

      assert.equal(preview.url, url);
      assert.ok(preview.title === undefined || typeof preview.title === "string");
      assert.ok(preview.image === undefined || typeof preview.image.source === "string");
    });

    it("a link nothing is known about is not made up", async () => {
      // Two honest answers: fail, or say nothing is known. The one that will not do is making up a title.
      const answer = await adapter.previewLink("https://no-existe.invalid/nada").catch(error => error);

      if (answer instanceof Error) {
        assert.equal(typeof answer.message, "string");
        return;
      }
      assert.equal(answer.title, undefined);
      assert.equal(answer.description, undefined);
      assert.equal(answer.image, undefined);
    });

    it("says whether a conversation is encrypted, not what was asked for when creating it", async () => {
      const encryptedOne = await adapter.createConversation({
        participantIds: [],
        title: `encrypted-${Date.now()}`,
        encrypted: true
      });
      assert.equal(encryptedOne.isEncrypted, true, "asking for encryption did not leave the conversation encrypted");

      // Without asking, the homeserver decides, so all that is required is that it says so, not what the
      // answer is: that depends on the policy of whoever runs it.
      const unasked = await adapter.createConversation({ participantIds: [], title: `unasked-${Date.now()}` });
      assert.equal(typeof unasked.isEncrypted, "boolean", "the conversation does not say whether it is encrypted");
    });

    it("lists what hangs off a conversation without opening each thread", async () => {
      const question = await adapter.sendMessage(conversationId, `question-${Date.now()}`, { transactionId: `txn-q-${Date.now()}` });
      await adapter.sendMessage(conversationId, "an answer", { transactionId: `txn-a-${Date.now()}`, threadId: question.id });

      const threads = await waitFor("the thread to be known", async () => {
        const listed = await adapter.listThreads(conversationId);
        return listed.find(thread => thread.rootId === question.id);
      });
      assert.equal(threads.rootId, question.id);
      assert.ok(threads.replyCount >= 1);
      assert.equal(typeof threads.conversationId, "string");
    });

    it("reading inside a thread does not say the conversation was read", async () => {
      const question = await adapter.sendMessage(conversationId, `another-${Date.now()}`, { transactionId: `txn-q2-${Date.now()}` });
      const answer = await adapter.sendMessage(conversationId, "answering", { transactionId: `txn-a2-${Date.now()}`, threadId: question.id });
      await adapter.markMessageRead(conversationId, question.id);
      // The marker has to have landed before this proves anything, or a late arrival looks like the thread
      // moving it. What is being checked is that reading the thread changes nothing from here on.
      const beforehand = await waitFor("the conversation marker to land", async () => {
        const found = (await adapter.listConversations()).find(item => item.id === conversationId);
        return found?.lastReadMessageId === question.id ? found.lastReadMessageId : undefined;
      });

      await adapter.markMessageRead(conversationId, answer.id, { threadId: question.id });

      const afterwards = (await adapter.listConversations()).find(item => item.id === conversationId)?.lastReadMessageId;
      assert.equal(afterwards, beforehand, "reading a thread moved the marker of the whole conversation");
    });

    it("silences somebody without ignoring them, and lets them be heard again", async () => {
      const noisy = "@noisy-for-testing:localhost";

      await adapter.setUserMuted(noisy, true);
      assert.ok((await adapter.listMutedUsers()).includes(noisy));
      // Silencing is not ignoring: what they say still arrives.
      assert.ok(!(await adapter.listIgnoredUsers()).includes(noisy));

      await adapter.setUserMuted(noisy, false);
      assert.ok(!(await adapter.listMutedUsers()).includes(noisy));
    });

    it("says how much anything at all may interrupt, and changes it", async () => {
      await adapter.setNotificationLevel("mentions");
      assert.equal(await adapter.getNotificationLevel(), "mentions");

      await adapter.setNotificationLevel("none");
      assert.equal(await adapter.getNotificationLevel(), "none");

      await adapter.setNotificationLevel("all");
      assert.equal(await adapter.getNotificationLevel(), "all");
    });

    it("puts a conversation back to unread and takes the mark off again", async () => {
      const marked = await adapter.setConversationUnread(conversationId, true);
      assert.equal(marked.isUnread, true);

      const listed = await waitFor("the mark to come back", async () => {
        const conversations = await adapter.listConversations();
        const current = conversations.find(item => item.id === conversationId);
        return current?.isUnread === true ? current : undefined;
      });
      assert.equal(listed.isUnread, true);

      const cleared = await adapter.setConversationUnread(conversationId, false);
      assert.equal(cleared.isUnread, false);
    });

    it("reads a message without telling the others, and the marker still moves", async () => {
      const sent = await adapter.sendMessage(conversationId, `quietly-${Date.now()}`, { transactionId: `txn-quiet-${Date.now()}` });

      await adapter.markMessageRead(conversationId, sent.id, { private: true });

      const current = await waitFor("the marker to move", async () => {
        const conversations = await adapter.listConversations();
        const found = conversations.find(item => item.id === conversationId);
        return found?.lastReadMessageId === sent.id ? found : undefined;
      });
      assert.equal(current.lastReadMessageId, sent.id);
    });

    it("says what the homeserver is holding, which is what a cold start shows", async () => {
      const waiting = await adapter.listPendingNotifications(20);

      assert.ok(Array.isArray(waiting));
      assert.ok(waiting.length <= 20);
      assert.ok(waiting.every(item => typeof item.conversationId === "string" && typeof item.messageId === "string"));
      assert.ok(waiting.every(item => typeof item.isMention === "boolean"));
    });

    it("finds people by name, without knowing their identifier", async () => {
      // Inviting somebody you can only name by their full identifier is not something anybody can do from a
      // screen. The directory is how a person is found by the name they go by.
      // A homeserver builds its directory in its own time, and on one that has just been started there is
      // nothing in it yet. What is being checked is that the directory answers, not how quickly it fills.
      const looking = name === "in-memory" ? "bob" : (process.env.MATRIX_USER_B ?? "bob");
      const found = await waitFor(`the directory to know ${participant}`, async () => {
        const people = await adapter.searchUsers(looking, 10);
        return people.some(user => user.id === participant) ? people : undefined;
      });

      assert.ok(found.some(user => user.id === participant), `${participant} is not among ${found.map(u => u.id)}`);
      assert.ok(found.every(user => typeof user.id === "string" && user.id.length > 0));
    });

    it("sends a reply that points at the message it answers", async () => {
      const original = await adapter.sendMessage(conversationId, `original-${Date.now()}`, { transactionId: `txn-original-${Date.now()}` });

      const reply = await adapter.sendMessage(conversationId, "respuesta", { transactionId: `txn-reply-${Date.now()}`, replyToId: original.id });

      assert.equal(reply.replyToId, original.id);
      assert.equal(original.replyToId, undefined);
      const listed = await waitFor("the reply to reach the timeline", async () => {
        const messages = await adapter.listMessages(conversationId);
        return messages.find(message => message.id === reply.id);
      });
      assert.equal(listed.replyToId, original.id);
    });

    it("invites, renames and leaves a conversation of its own", async () => {
      const own = await adapter.createConversation({ participantIds: [], title: "RelayKit contract lifecycle", encrypted: false });

      const invited = await adapter.inviteToConversation(own.id, participant);
      assert.ok(invited.participantIds.includes(participant));

      const renamed = await adapter.renameConversation(own.id, "Renombrada");
      assert.equal(renamed.title, "Renombrada");

      await adapter.leaveConversation(own.id);
      const listed = await waitFor("the conversation to disappear", async () => {
        const conversations = await adapter.listConversations();
        return conversations.every(item => item.id !== own.id) ? conversations : undefined;
      });
      assert.ok(listed.every(item => item.id !== own.id));
    });

    it("lists the devices of the account with the current one marked", async () => {
      const devices = await adapter.listDevices();

      assert.ok(devices.length > 0);
      assert.equal(devices.filter(device => device.isCurrent).length, 1);
      assert.ok(devices.every(device => typeof device.id === "string" && device.id.length > 0));
    });

    it("changes the display name of the account and reads it back", async () => {
      const ownUserId = name === "in-memory" ? "alice" : `@${matrixUser}:localhost`;
      const chosen = `RelayKit ${Date.now()}`;

      await adapter.setDisplayName(chosen);

      const profile = await waitFor("the new display name", async () => {
        const current = await adapter.getProfile(ownUserId);
        return current.displayName === chosen ? current : undefined;
      });
      assert.equal(profile.displayName, chosen);
    });

    it("remembers who the account is ignoring", async () => {
      const ignored = "@nobody-ignored:localhost";

      await adapter.setIgnoredUsers([ignored]);
      assert.ok((await adapter.listIgnoredUsers()).includes(ignored));

      await adapter.setIgnoredUsers([]);
      assert.ok(!(await adapter.listIgnoredUsers()).includes(ignored));
    });

    it("marks a conversation as a favourite and takes the mark away", async () => {
      const favourite = await adapter.setConversationFavourite(conversationId, true);
      assert.equal(favourite.isFavourite, true);

      const plain = await adapter.setConversationFavourite(conversationId, false);
      assert.equal(plain.isFavourite, undefined);
    });

    it("removes somebody from a conversation of its own", async () => {
      const own = await adapter.createConversation({ participantIds: [participant], title: "RelayKit contract kick", encrypted: false });
      await waitFor("the participant to be invited", async () => {
        const conversations = await adapter.listConversations();
        return conversations.find(item => item.id === own.id)?.participantIds.includes(participant);
      });

      const removed = await adapter.removeFromConversation(own.id, participant, "no encaja");

      assert.ok(!removed.participantIds.includes(participant));
      await adapter.leaveConversation(own.id);
    });

    it("marks a message as read and can be asked who read it", async () => {
      const sent = await adapter.sendMessage(conversationId, `read-${Date.now()}`, { transactionId: `txn-read-${Date.now()}` });

      await adapter.markMessageRead(conversationId, sent.id);

      const marked = await waitFor("the conversation to remember where it was left", async () => {
        const conversations = await adapter.listConversations();
        const found = conversations.find(item => item.id === conversationId);
        return found?.lastReadMessageId === sent.id ? found : undefined;
      });
      assert.equal(marked.lastReadMessageId, sent.id);

      const receipts = await adapter.getReadReceipts(conversationId, sent.id);
      assert.ok(Array.isArray(receipts));
      assert.ok(receipts.every(receipt => receipt.messageId === sent.id && typeof receipt.readAt === "number"));
    });

    it("gives the name somebody uses in a conversation when one is named", async () => {
      const everywhere = await adapter.getProfile(participant);
      const inConversation = await adapter.getProfile(participant, conversationId);

      assert.equal(everywhere.id, participant);
      assert.equal(inConversation.id, participant);
      // Nobody set a different name here, so both answers say the same thing.
      assert.equal(inConversation.displayName, everywhere.displayName);
    });

    it("replaces a conversation and leaves a way to reach the new one", async () => {
      const original = await adapter.createConversation({
        participantIds: [],
        title: `RelayKit contract upgrade ${Date.now()}`,
        encrypted: false
      });

      const replacement = await adapter.upgradeConversation(original.id);

      assert.notEqual(replacement.id, original.id);
      assert.equal(replacement.replaces, original.id);
      const listed = await waitFor("the old conversation to point at the new one", async () => {
        const conversations = await adapter.listConversations();
        return conversations.find(item => item.id === original.id && item.replacedBy === replacement.id);
      });
      assert.equal(listed.replacedBy, replacement.id);
      await adapter.leaveConversation(replacement.id);
      await adapter.leaveConversation(original.id);
    });

    it("reports a message to whoever runs the server", async () => {
      const sent = await adapter.sendMessage(conversationId, `reportable-${Date.now()}`, {
        transactionId: `txn-report-${Date.now()}`
      });

      await adapter.reportMessage(conversationId, sent.id, "prueba del contrato");
    });

    it("gives a conversation a name people can type, lists it and finds it again", async () => {
      const localName = `relaykit-contract-${Date.now()}`;
      const alias = `#${localName}:${homeserverName}`;

      const named = await adapter.setConversationAlias(conversationId, alias);
      assert.equal(named.alias, alias);

      // A list pointing at a door only invited people can open is no use, so it has to be open first.
      await adapter.setJoinRule(conversationId, "public");
      await adapter.publishConversation(conversationId, true);
      const found = await waitFor("the conversation to appear on the public list", async () => {
        const listed = await adapter.discoverConversations(localName);
        return listed.find(item => item.id === conversationId);
      });
      assert.equal(found.alias, alias);
      assert.equal(typeof found.participantCount, "number");

      await adapter.publishConversation(conversationId, false);
      await waitFor("the conversation to leave the public list", async () => {
        const listed = await adapter.discoverConversations(localName);
        return listed.every(item => item.id !== conversationId);
      });
      await adapter.setJoinRule(conversationId, "invite");
    });

    it("decides who may come in and how far back a newcomer can read", async () => {
      const opened = await adapter.setJoinRule(conversationId, "public");
      assert.equal(opened.joinRule, "public");

      const knocking = await adapter.setJoinRule(conversationId, "knock");
      assert.equal(knocking.joinRule, "knock");

      const narrowed = await adapter.setHistoryVisibility(conversationId, "joined");
      assert.equal(narrowed.historyVisibility, "joined");

      const listed = await waitFor("the decision to settle", async () => {
        const conversations = await adapter.listConversations();
        const found = conversations.find(item => item.id === conversationId);
        return found?.joinRule === "knock" && found.historyVisibility === "joined" ? found : undefined;
      });
      assert.equal(listed.joinRule, "knock");

      await adapter.setJoinRule(conversationId, "invite");
    });

    it("watches for a word so a message saying it interrupts, and stops watching", async () => {
      const word = `contrato${Date.now()}`;

      await adapter.watchForKeyword(word);

      const watched = await adapter.listKeywords();
      assert.ok(watched.includes(word), `the word must be watched for: ${watched.join(", ")}`);

      await adapter.stopWatchingForKeyword(word);
      assert.ok(!(await adapter.listKeywords()).includes(word));
    });

    it("registers this device for notifications while the application is closed, and forgets it", async () => {
      const deviceToken = `https://push.example.com/endpoint/${Date.now()}`;
      const registration = {
        gatewayUrl: "https://push.example.com/_matrix/push/v1/notify",
        deviceToken,
        appId: "com.example.relaykit.contract",
        appName: "RelayKit contract",
        deviceName: "Contract"
      };

      await adapter.registerPush(registration);

      const registered = await adapter.listPushRegistrations();
      const found = registered.find(item => item.deviceToken === deviceToken);
      assert.ok(found, "the registration must be listed");
      assert.equal(found.gatewayUrl, registration.gatewayUrl);
      assert.equal(found.appId, registration.appId);

      await adapter.unregisterPush(deviceToken);
      const afterwards = await adapter.listPushRegistrations();
      assert.ok(afterwards.every(item => item.deviceToken !== deviceToken));
    });

    it("gives the conversation a description that everyone in it can read", async () => {
      const topic = `de que hablamos ${Date.now()}`;

      await adapter.setConversationTopic(conversationId, topic);

      const current = await waitFor("the description to settle", async () => {
        const conversations = await adapter.listConversations();
        const found = conversations.find(item => item.id === conversationId);
        return found?.topic === topic ? found : undefined;
      });
      assert.equal(current.topic, topic);
    });

    it("silences a conversation and lets it speak again", async () => {
      const silenced = await adapter.setConversationNotifications(conversationId, "none");
      assert.equal(silenced.notifications, "none");

      const mentions = await adapter.setConversationNotifications(conversationId, "mentions");
      assert.equal(mentions.notifications, "mentions");

      const back = await adapter.setConversationNotifications(conversationId, "all");
      assert.ok(back.notifications === undefined || back.notifications === "all");
    });

    it("pins a message so it can be found later, and unpins it", async () => {
      const sent = await adapter.sendMessage(conversationId, `pinned-${Date.now()}`, {
        transactionId: `txn-pin-${Date.now()}`
      });

      await adapter.pinMessage(conversationId, sent.id);

      const knownByTheConversation = await waitFor("the conversation to say what it keeps to hand", async () => {
        const conversations = await adapter.listConversations();
        return conversations.find(item => item.id === conversationId)?.pinnedIds?.includes(sent.id);
      });
      assert.ok(knownByTheConversation);

      const pinned = await waitFor("the pinned message to be listed", async () => {
        const listed = await adapter.listPinnedMessages(conversationId);
        return listed.find(message => message.id === sent.id);
      });
      assert.equal(pinned.body, sent.body);

      await adapter.unpinMessage(conversationId, sent.id);
      await waitFor("the message to stop being pinned", async () => {
        const listed = await adapter.listPinnedMessages(conversationId);
        return listed.every(message => message.id !== sent.id);
      });
    });

    it("sends formatted text, a mention and an action, and reads them back", async () => {
      const body = `rico-${Date.now()}`;

      const sent = await adapter.sendMessage(conversationId, body, {
        transactionId: `txn-rich-${Date.now()}`,
        formattedBody: `<strong>${body}</strong>`,
        mentions: { userIds: [participant] }
      });
      assert.equal(sent.formattedBody, `<strong>${body}</strong>`);
      assert.deepEqual(sent.mentions?.userIds, [participant]);

      const action = await adapter.sendMessage(conversationId, "saluda", {
        transactionId: `txn-action-${Date.now()}`,
        kind: "action"
      });
      assert.equal(action.kind, "action");

      const readBack = await waitFor("the formatted message to reach the timeline", async () => {
        const listed = await adapter.listMessages(conversationId);
        return listed.find(message => message.id === sent.id);
      });
      assert.equal(readBack.formattedBody, `<strong>${body}</strong>`);
    });
  });
}

runContract("in-memory", inMemorySetup);

if (process.env.RELAYKIT_CONTRACT_MATRIX === "1") {
  runContract("matrix", matrixSetup);
}
