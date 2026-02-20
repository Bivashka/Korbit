export type UserRole = 'USER' | 'ADMIN';

export type UserProfile = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  role: UserRole;
};

export type ChatPeer = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type MessageItem = {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sender: ChatPeer;
};

export type ChatItem = {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'CHANNEL';
  peer: ChatPeer | null;
  lastReadMessageId: string | null;
  lastMessage: MessageItem | null;
};

export type AuthPayload = {
  accessToken: string;
  refreshToken: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  user: UserProfile;
};

