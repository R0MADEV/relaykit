import assert from "node:assert/strict";
import test from "node:test";

const { getMatrixProfile, getMatrixAvatar } = await import("../packages/matrix-js/dist/matrix-profiles.js");

const roomId = "!room:example.org";
const userId = "@bob:example.org";

function fakeClient({ member, asked }) {
  return {
    getProfileInfo: async () => {
      asked.profile += 1;
      return { displayname: "Bob de perfil", avatar_url: "mxc://example.org/perfil" };
    },
    getRoom: id => (id === roomId && member ? { getMember: () => member } : undefined),
    http: {
      // The media server is not what is being tested here, so it answers without leaving the process.
      authedRequest: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    }
  };
}

function memberCalled(name, avatar) {
  return { rawDisplayName: name, getMxcAvatarUrl: () => avatar };
}

test("the name somebody uses in a conversation is taken from what is already here", async () => {
  const asked = { profile: 0 };
  const client = fakeClient({ member: memberCalled("Bob de guardia", "mxc://example.org/sala"), asked });

  const profile = await getMatrixProfile(client, userId, roomId);

  assert.equal(profile.displayName, "Bob de guardia");
  assert.equal(asked.profile, 0, "asking the server for what is already here is a wasted round trip");
});

test("somebody the conversation knows nothing about is still asked for", async () => {
  const asked = { profile: 0 };
  const client = fakeClient({ member: undefined, asked });

  const profile = await getMatrixProfile(client, userId, roomId);

  assert.equal(profile.displayName, "Bob de perfil");
  assert.equal(asked.profile, 1);
});

test("a member with no name of their own falls back to the profile", async () => {
  const asked = { profile: 0 };
  const client = fakeClient({ member: memberCalled(undefined, undefined), asked });

  const profile = await getMatrixProfile(client, userId, roomId);

  assert.equal(profile.displayName, "Bob de perfil");
  assert.equal(asked.profile, 1);
});

test("without a conversation the name everywhere is asked for, which is what it means", async () => {
  const asked = { profile: 0 };
  const client = fakeClient({ member: memberCalled("Bob de guardia", undefined), asked });

  const profile = await getMatrixProfile(client, userId);

  assert.equal(profile.displayName, "Bob de perfil");
  assert.equal(asked.profile, 1);
});

test("the picture of somebody in a conversation is taken from what is already here", async () => {
  const asked = { profile: 0 };
  const client = fakeClient({ member: memberCalled("Bob de guardia", "mxc://example.org/sala"), asked });

  const image = await (getMatrixAvatar(client, userId, roomId));

  assert.equal(image?.mimeType, "image/png");
  assert.equal(asked.profile, 0);
});
