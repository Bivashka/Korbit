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

export type MessageReference = {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  isDeleted: boolean;
  deletedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sender: ChatPeer;
};

export type MessageReaction = {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
  user: ChatPeer;
};

export type MessageItem = {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  isDeleted: boolean;
  deletedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sender: ChatPeer;
  attachments?: AttachmentItem[];
  reactions?: MessageReaction[];
  replyToMessage?: MessageReference | null;
  forwardedFromMessage?: MessageReference | null;
};

export type ChatItem = {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'CHANNEL';
  peer: ChatPeer | null;
  lastReadMessageId: string | null;
  peerLastReadMessageId: string | null;
  lastMessage: MessageItem | null;
  pinnedMessage: MessageReference | null;
  unreadCount: number;
};

export type AttachmentItem = {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
};

export type AuthPayload = {
  accessToken: string;
  refreshToken: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  user: UserProfile;
};

export type BuildTarget = 'windows' | 'android';
export type BuildStatus = 'idle' | 'running' | 'success' | 'failed';

export type AdminBuildState = {
  target: BuildTarget;
  status: BuildStatus;
  runId: number;
  startedAt: string | null;
  finishedAt: string | null;
  initiatedBy: string | null;
  artifactName: string | null;
  artifactSize: number | null;
  artifactCreatedAt: string | null;
  artifactUrl: string | null;
  lastError: string | null;
  logTail: string[];
};

export type AdminBuildArtifact = {
  name: string;
  size: number;
  createdAt: string;
  url: string;
  target: BuildTarget | 'unknown';
};

export type AdminBuildsResponse = {
  builds: AdminBuildState[];
  artifacts: AdminBuildArtifact[];
  targets: BuildTarget[];
};
