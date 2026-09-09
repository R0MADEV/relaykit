import type { MatrixClient } from "matrix-js-sdk";
import type { AvatarImage, User, UserId } from "@relaykit/core";

/** The homeserver has no profile for unknown users, which is not an error worth propagating. */
export async function getMatrixProfile(client: MatrixClient, userId: UserId): Promise<User> {
  const profile = await client.getProfileInfo(userId).catch(() => undefined);
  return {
    id: userId,
    ...(profile?.displayname ? { displayName: profile.displayname } : {}),
    ...(profile?.avatar_url ? { avatarId: profile.avatar_url } : {})
  };
}

export async function getMatrixAvatar(client: MatrixClient, userId: UserId): Promise<AvatarImage | undefined> {
  const { avatarId } = await getMatrixProfile(client, userId);
  if (!avatarId) {
    return undefined;
  }
  const url = client.mxcUrlToHttp(avatarId, undefined, undefined, undefined, false, true, true);
  const accessToken = client.getAccessToken();
  if (!url || !accessToken) throw new Error("The avatar cannot be resolved");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`The media server responded with status ${response.status}`);
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? "application/octet-stream"
  };
}
