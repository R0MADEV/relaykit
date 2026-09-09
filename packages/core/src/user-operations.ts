import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { AvatarImage, User, UserId } from "./models.js";

export interface UserOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class UserOperations {
  constructor(private readonly context: UserOperationsContext) {}

  async profile(userId: UserId): Promise<User> {
    return this.context.adapter.getProfile(this.require(userId));
  }

  async avatar(userId: UserId): Promise<AvatarImage | undefined> {
    return this.context.adapter.getAvatar(this.require(userId));
  }

  private require(userId: UserId): UserId {
    this.context.assertStarted();
    const trimmed = userId.trim();
    if (!trimmed) {
      throw new SdkError("INVALID_INPUT", "A user id is required");
    }
    return trimmed;
  }
}
