import { MatrixError, type MatrixClient } from "matrix-js-sdk";
import { SdkError } from "@relaykit/core";
import { downloadFromMediaServer } from "./matrix-media.js";
import type { AvatarImage, Device, SignOutOptions, User, UserId } from "@relaykit/core";

/**
 * The homeserver has no profile for unknown users, which is not an error worth propagating. Naming a
 * conversation gives the name that person uses there, which can differ from the one they use everywhere.
 */
export async function getMatrixProfile(
  client: MatrixClient,
  userId: UserId,
  conversationId?: string
): Promise<User> {
  // Somebody in a conversation is already described by what has been synced, and a screen full of names was a
  // request each. The server is only asked about people the conversation says nothing about.
  const member = conversationId ? client.getRoom(conversationId)?.getMember(userId) : undefined;
  const inConversation = member?.rawDisplayName;
  if (inConversation) {
    const avatarId = member?.getMxcAvatarUrl();
    return { id: userId, displayName: inConversation, ...(avatarId ? { avatarId } : {}) };
  }
  const profile = await client.getProfileInfo(userId).catch(() => undefined);
  const avatarId = member?.getMxcAvatarUrl() ?? profile?.avatar_url;
  return {
    id: userId,
    ...(profile?.displayname ? { displayName: profile.displayname } : {}),
    ...(avatarId ? { avatarId } : {})
  };
}

/**
 * A size asks the media server to resize before sending. A conversation list paints dozens of pictures at a
 * couple of dozen pixels each, and fetching the original of every one of them is the difference between a
 * list that opens and one that downloads megabytes to throw almost all of them away.
 */
export async function getMatrixAvatar(
  client: MatrixClient,
  userId: UserId,
  conversationId?: string,
  size?: number
): Promise<AvatarImage | undefined> {
  const { avatarId } = await getMatrixProfile(client, userId, conversationId);
  if (!avatarId) {
    return undefined;
  }
  return downloadFromMediaServer(client, avatarId, size);
}

/**
 * The homeserver's user directory. It only knows about people it has seen, which for a private homeserver is
 * everybody on it, and for a federated one is everybody this account has shared a conversation with.
 */
export async function searchMatrixUsers(client: MatrixClient, query: string, limit: number): Promise<readonly User[]> {
  const { results } = await client.searchUserDirectory({ term: query, limit });
  return results.map(result => ({
    id: result.user_id,
    ...(result.display_name ? { displayName: result.display_name } : {}),
    ...(result.avatar_url ? { avatarId: result.avatar_url } : {})
  }));
}

/** Uploads the picture and points the profile at it, which is two steps in Matrix. */
export async function setMatrixAvatar(client: MatrixClient, image: AvatarImage): Promise<void> {
  const bytes = image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.data.byteLength);
  const upload = await client.uploadContent(new Blob([bytes as ArrayBuffer]), { type: image.mimeType, includeFilename: false });
  await client.setAvatarUrl(upload.content_uri);
}

export async function listMatrixDevices(client: MatrixClient): Promise<readonly Device[]> {
  const { devices } = await client.getDevices();
  const currentDeviceId = client.getDeviceId();
  return devices.map(device => ({
    id: device.device_id,
    isCurrent: device.device_id === currentDeviceId,
    ...(device.display_name ? { displayName: device.display_name } : {}),
    ...(typeof device.last_seen_ts === "number" ? { lastSeenAt: device.last_seen_ts } : {}),
    ...(device.last_seen_ip ? { lastSeenIp: device.last_seen_ip } : {})
  }));
}

/**
 * Closing other sessions is a sensitive action, so the homeserver asks for the password again. The first
 * attempt is made without it to learn what is required, as the protocol expects.
 */
export async function signOutMatrixDevices(
  client: MatrixClient,
  deviceIds: readonly string[],
  options: SignOutOptions
): Promise<void> {
  try {
    await client.deleteMultipleDevices([...deviceIds]);
    return;
  } catch (error) {
    if (!(error instanceof MatrixError) || error.httpStatus !== 401) throw error;
    if (!options.password) {
      throw new SdkError("INVALID_INPUT", "The homeserver asks for the password to close other sessions");
    }
    const session = (error.data as { session?: string }).session;
    await client.deleteMultipleDevices([...deviceIds], {
      type: "m.login.password",
      user: client.getSafeUserId(),
      identifier: { type: "m.id.user", user: client.getSafeUserId() },
      password: options.password,
      ...(session ? { session } : {})
    });
  }
}
