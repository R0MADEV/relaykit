import assert from "node:assert/strict";
import test from "node:test";

const { setMatrixAvatar } = await import("../packages/matrix-js/dist/matrix-profiles.js");

/**
 * A Uint8Array is often a window onto a larger buffer, and handing that buffer to a Blob uploads everything
 * around the picture as well as the picture. What goes up has to be the window and nothing else. Setting a
 * conversation's picture uploads through this same step.
 */
test("a picture that is a window onto a bigger buffer is uploaded as just that window", async () => {
  const uploaded = [];
  const client = {
    uploadContent: async (blob, options) => {
      uploaded.push({ bytes: new Uint8Array(await blob.arrayBuffer()), options });
      return { content_uri: "mxc://media.example/retrato" };
    },
    setAvatarUrl: async url => {
      uploaded.push({ url });
    }
  };
  const justThePicture = new Uint8Array([9, 9, 137, 80, 78, 71, 9, 9]).subarray(2, 6);

  await setMatrixAvatar(client, { mimeType: "image/png", data: justThePicture });

  assert.deepEqual([...uploaded[0].bytes], [137, 80, 78, 71]);
  assert.equal(uploaded[0].options.type, "image/png");
  assert.equal(uploaded[0].options.includeFilename, false);
  assert.equal(uploaded[1].url, "mxc://media.example/retrato");
});
