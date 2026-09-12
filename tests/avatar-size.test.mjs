import assert from "node:assert/strict";
import test from "node:test";

const { getMatrixAvatar } = await import("../packages/matrix-js/dist/matrix-profiles.js");

/**
 * A conversation list paints dozens of pictures at a couple of dozen pixels each. Fetching the original of
 * every one of them is the difference between a list that opens and a list that downloads megabytes to throw
 * almost all of them away. The media server resizes; it only has to be asked.
 *
 * The asking goes through the SDK's own authenticated request, so nobody here writes an Authorization header
 * by hand or decides what a media URL looks like.
 */
function fakeClient(asked) {
  return {
    getRoom: () => undefined,
    getProfileInfo: async () => ({ displayname: "Ana", avatar_url: "mxc://media.example/retrato" }),
    http: {
      authedRequest: async (method, path, params, body, opts) => {
        asked.push({ method, path, params, opts });
        return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      }
    }
  };
}

test("a picture wanted small is asked of the media server already small", async () => {
  const asked = [];

  const image = await getMatrixAvatar(fakeClient(asked), "@ana:localhost", undefined, 32);

  assert.equal(asked[0].path, "/media/thumbnail/media.example/retrato");
  assert.deepEqual(asked[0].params, { width: "32", height: "32", method: "crop" });
  assert.equal(asked[0].opts.rawResponseBody, true);
  assert.deepEqual([...image.data], [1, 2, 3]);
  assert.equal(image.mimeType, "image/png");
});

test("a picture wanted whole is asked for whole, not resized to nothing", async () => {
  const asked = [];

  await getMatrixAvatar(fakeClient(asked), "@ana:localhost");

  assert.equal(asked[0].path, "/media/download/media.example/retrato");
  assert.equal(asked[0].params, undefined);
});

test("somebody with no picture is not asked about at all", async () => {
  const asked = [];
  const client = fakeClient(asked);
  client.getProfileInfo = async () => ({ displayname: "Ana" });

  assert.equal(await getMatrixAvatar(client, "@ana:localhost"), undefined);
  assert.equal(asked.length, 0);
});
