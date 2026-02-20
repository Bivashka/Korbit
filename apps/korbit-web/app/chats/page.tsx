'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  ApiError,
  createDirectChat,
  deleteMessage,
  forwardMessage,
  getMe,
  getSocketConfig,
  isAuthenticated,
  listChats,
  listMessages,
  logout,
  markRead,
  pinMessage,
  searchMessages,
  sendMessage,
  toggleReaction,
  unpinMessage,
  updateMessage,
  uploadAttachment,
} from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import {
  AttachmentItem,
  ChatItem,
  MessageItem,
  MessageReference,
  UserProfile,
} from '../../lib/types';

type PresenceState = Record<string, 'online' | 'offline'>;
type CallType = 'audio' | 'video';

type CallOfferEvent = {
  chatId: string;
  senderId: string;
  sdp: RTCSessionDescriptionInit;
  type: CallType;
};

type CallAnswerEvent = {
  chatId: string;
  senderId: string;
  sdp: RTCSessionDescriptionInit;
};

type IceCandidateEvent = {
  chatId: string;
  senderId: string;
  candidate: RTCIceCandidateInit;
};

type IncomingCall = {
  chatId: string;
  senderId: string;
  sdp: RTCSessionDescriptionInit;
  type: CallType;
};

type RecordingMode = 'audio' | 'video';
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮'];

export default function ChatsPage() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageElementsRef = useRef<Record<string, HTMLElement | null>>({});
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const currentCallChatIdRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaRecorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  const [me, setMe] = useState<UserProfile | null>(null);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [newChatUsername, setNewChatUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [creatingChat, setCreatingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [presence, setPresence] = useState<PresenceState>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<MessageItem | null>(null);
  const [forwardSourceMessage, setForwardSourceMessage] = useState<MessageItem | null>(
    null,
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [forwardTargetChatId, setForwardTargetChatId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<MessageItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callType, setCallType] = useState<CallType | null>(null);
  const [inCall, setInCall] = useState(false);
  const [callMuted, setCallMuted] = useState(false);
  const [callCameraEnabled, setCallCameraEnabled] = useState(true);
  const [callInfo, setCallInfo] = useState<string | null>(null);
  const [recordingMode, setRecordingMode] = useState<RecordingMode | null>(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [activeChatId, chats],
  );

  function canUseMediaDevices() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }
    return (
      window.isSecureContext &&
      Boolean(
        navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === 'function',
      )
    );
  }

  function toFriendlyMediaError(error: unknown) {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return 'Звонки доступны только по HTTPS. Открой сайт по защищённому адресу.';
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      return 'Браузер не поддерживает доступ к микрофону/камере.';
    }

    const errorName =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: string }).name)
        : '';

    if (errorName === 'NotAllowedError') {
      return 'Доступ к микрофону/камере запрещён. Разреши доступ в браузере.';
    }
    if (errorName === 'NotFoundError') {
      return 'Микрофон или камера не найдены на устройстве.';
    }
    if (errorName === 'NotReadableError') {
      return 'Устройство занято другим приложением.';
    }

    return 'Не удалось получить доступ к микрофону/камере.';
  }

  async function requestLocalMedia(type: CallType) {
    if (!canUseMediaDevices()) {
      throw new Error(
        'Звонки доступны только по HTTPS и при разрешённом доступе к устройствам.',
      );
    }

    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video',
    });
  }

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }

    const load = async () => {
      try {
        const [profile, chatList] = await Promise.all([getMe(), listChats()]);
        setMe(profile);
        setChats(chatList);
        if (chatList.length > 0) {
          setActiveChatId(chatList[0].id);
        }
      } catch (rawError) {
        if (rawError instanceof ApiError && rawError.status === 401) {
          await logout();
          router.replace('/login');
          return;
        }
        setError(rawError instanceof Error ? rawError.message : 'Ошибка загрузки');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [router]);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      try {
        const payload = await listMessages(activeChatId);
        setMessages(payload.items);
        const latest = payload.items[payload.items.length - 1];
        if (latest) {
          void markRead(activeChatId, latest.id).catch(() => undefined);
        }
      } catch (rawError) {
        setError(rawError instanceof Error ? rawError.message : 'Ошибка загрузки сообщений');
      }
    };

    void loadMessages();
  }, [activeChatId]);

  useEffect(() => {
    setReplyToMessage((previous) =>
      previous && previous.chatId === activeChatId ? previous : null,
    );
    setForwardTargetChatId(activeChatId ?? null);
    setEditingMessageId((previous) =>
      previous && messages.some((item) => item.id === previous) ? previous : null,
    );
  }, [activeChatId, messages]);

  useEffect(() => {
    setSearchInput('');
    setSearchResults([]);
    setHighlightedMessageId(null);
  }, [activeChatId]);

  useEffect(() => {
    if (inCall) {
      setMediaRefs();
    }
  }, [inCall, callType]);

  function setMediaRefs() {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      if (localStreamRef.current) {
        void localVideoRef.current.play().catch(() => undefined);
      }
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      if (remoteStreamRef.current) {
        void remoteVideoRef.current.play().catch(() => undefined);
      }
    }
  }

  function stopLocalStream() {
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    localStreamRef.current = null;
  }

  function cleanupCallState() {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    stopLocalStream();
    remoteStreamRef.current = null;
    pendingIceCandidatesRef.current = [];
    currentCallChatIdRef.current = null;
    incomingCallRef.current = null;
    setIncomingCall(null);
    setInCall(false);
    setCallType(null);
    setCallMuted(false);
    setCallCameraEnabled(true);
    setMediaRefs();
  }

  async function flushPendingIceCandidates() {
    const connection = peerConnectionRef.current;
    if (!connection?.remoteDescription) {
      return;
    }

    const pending = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];
    for (const candidate of pending) {
      try {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        setCallInfo('Ошибка ICE-кандидата');
      }
    }
  }

  function createPeerConnection(chatId: string) {
    const connection = new RTCPeerConnection({
      iceServers: [
        {
          urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
        },
      ],
    });

    connection.onicecandidate = (event) => {
      if (!event.candidate || !socketRef.current) {
        return;
      }
      socketRef.current.emit('call_ice_candidate', {
        chatId,
        candidate: event.candidate.toJSON(),
      });
    };

    connection.ontrack = (event) => {
      if (event.streams[0]) {
        remoteStreamRef.current = event.streams[0];
      } else {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        const hasTrack = remoteStreamRef.current
          .getTracks()
          .some((track) => track.id === event.track.id);
        if (!hasTrack) {
          remoteStreamRef.current.addTrack(event.track);
        }
      }
      setMediaRefs();
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        setCallInfo('Сбой соединения звонка');
      }
      if (connection.connectionState === 'disconnected') {
        setCallInfo('Собеседник отключился');
        cleanupCallState();
      }
      if (connection.connectionState === 'connected') {
        setCallInfo('Звонок установлен');
      }
    };

    connection.oniceconnectionstatechange = () => {
      if (
        connection.iceConnectionState === 'failed' ||
        connection.iceConnectionState === 'disconnected'
      ) {
        setCallInfo('Проблема с сетевым соединением звонка');
      }
    };

    peerConnectionRef.current = connection;
    return connection;
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const socketConfig = getSocketConfig();
    const socket = io(socketConfig.namespaceUrl, {
      path: socketConfig.path,
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      if (me) {
        setPresence((previous) => ({ ...previous, [me.id]: 'online' }));
      }
    });

    socket.on(
      'presence_snapshot',
      (snapshot: Array<{ userId: string; status: 'online' | 'offline' }>) => {
        const next: PresenceState = {};
        for (const item of snapshot) {
          next[item.userId] = item.status;
        }
        setPresence((previous) => ({ ...previous, ...next }));
      },
    );

    socket.on(
      'presence',
      (event: { userId: string; status: 'online' | 'offline' }) => {
        setPresence((previous) => ({
          ...previous,
          [event.userId]: event.status,
        }));
      },
    );

    socket.on(
      'new_message',
      (message: MessageItem & { createdAt: string; updatedAt: string }) => {
        setChats((previous) => {
          const existing = previous.find((chat) => chat.id === message.chatId);
          if (!existing) {
            return previous;
          }

          const updated: ChatItem = {
            ...existing,
            lastMessage: message,
          };
          const rest = previous.filter((chat) => chat.id !== message.chatId);
          return [updated, ...rest];
        });

        if (message.chatId === activeChatIdRef.current) {
          setMessages((previous) => {
            const existingIndex = previous.findIndex((item) => item.id === message.id);
            if (existingIndex >= 0) {
              const next = [...previous];
              next[existingIndex] = message;
              return next;
            }
            return [...previous, message];
          });
          void markRead(message.chatId, message.id).catch(() => undefined);
        }
      },
    );

    socket.on(
      'message_updated',
      (message: MessageItem & { createdAt: string; updatedAt: string }) => {
        applyUpdatedMessage(message);
      },
    );

    socket.on(
      'typing',
      (event: { chatId: string; userId: string; isTyping: boolean }) => {
        if (event.chatId !== activeChatIdRef.current || event.userId === me?.id) {
          return;
        }
        setTypingUsers((previous) => {
          if (event.isTyping) {
            if (previous.includes(event.userId)) {
              return previous;
            }
            return [...previous, event.userId];
          }
          return previous.filter((item) => item !== event.userId);
        });
      },
    );

    socket.on(
      'read_receipt',
      (event: { chatId: string; userId: string; messageId: string | null }) => {
        setChats((previous) =>
          previous.map((chat) =>
            chat.id === event.chatId
              ? { ...chat, lastReadMessageId: event.messageId }
              : chat,
          ),
        );
      },
    );

    socket.on(
      'chat_pinned_message',
      (event: { chatId: string; pinnedMessage: MessageReference | null }) => {
        applyPinnedMessage(event.chatId, event.pinnedMessage);
      },
    );

    socket.on('call_offer', (event: CallOfferEvent) => {
      if (event.senderId === me?.id) {
        return;
      }
      pendingIceCandidatesRef.current = [];
      setIncomingCall(event);
      incomingCallRef.current = event;
      setCallInfo('Входящий звонок');
    });

    socket.on('call_answer', async (event: CallAnswerEvent) => {
      if (event.senderId === me?.id || !peerConnectionRef.current) {
        return;
      }
      if (event.chatId !== currentCallChatIdRef.current) {
        return;
      }
      try {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(event.sdp),
        );
        await flushPendingIceCandidates();
        setInCall(true);
        setCallInfo('Звонок установлен');
      } catch {
        setCallInfo('Не удалось завершить соединение звонка');
      }
    });

    socket.on('call_ice_candidate', async (event: IceCandidateEvent) => {
      if (event.senderId === me?.id) {
        return;
      }
      const expectedChatId =
        currentCallChatIdRef.current ?? incomingCallRef.current?.chatId ?? null;
      if (!expectedChatId || event.chatId !== expectedChatId) {
        return;
      }

      if (!peerConnectionRef.current || !peerConnectionRef.current.remoteDescription) {
        pendingIceCandidatesRef.current.push(event.candidate);
        return;
      }

      try {
        await peerConnectionRef.current.addIceCandidate(
          new RTCIceCandidate(event.candidate),
        );
      } catch {
        setCallInfo('Ошибка ICE-кандидата');
      }
    });

    socket.on('call_end', (event: { chatId: string; senderId: string }) => {
      if (event.chatId === currentCallChatIdRef.current) {
        setCallInfo('Звонок завершён');
        cleanupCallState();
      }
      if (event.chatId === incomingCallRef.current?.chatId) {
        setIncomingCall(null);
        incomingCallRef.current = null;
        pendingIceCandidatesRef.current = [];
      }
    });

    socket.on('connect_error', () => {
      setError('Ошибка соединения realtime');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      cleanupCallState();
    };
  }, [me]);

  useEffect(() => {
    return () => {
      stopRecording();
      stopRecorderStream();
      if (noticeTimeoutRef.current) {
        clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  async function onCreateChat(event: FormEvent) {
    event.preventDefault();
    const target = newChatUsername.trim();
    if (!target) {
      return;
    }

    setCreatingChat(true);
    setError(null);
    try {
      const chat = await createDirectChat(target);
      setChats((previous) => {
        const existing = previous.find((item) => item.id === chat.id);
        if (existing) {
          return [existing, ...previous.filter((item) => item.id !== chat.id)];
        }
        return [chat, ...previous];
      });
      setActiveChatId(chat.id);
      setNewChatUsername('');
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка создания чата');
    } finally {
      setCreatingChat(false);
    }
  }

  function upsertLocalMessage(message: MessageItem) {
    setMessages((previous) => {
      const existingIndex = previous.findIndex((item) => item.id === message.id);
      let next: MessageItem[];
      if (existingIndex >= 0) {
        next = [...previous];
        next[existingIndex] = message;
      } else {
        next = [...previous, message];
      }
      next.sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      );
      return next;
    });
    setChats((previous) => {
      const existing = previous.find((chat) => chat.id === message.chatId);
      if (!existing) {
        return previous;
      }
      const updated: ChatItem = {
        ...existing,
        lastMessage: message,
      };
      const rest = previous.filter((chat) => chat.id !== message.chatId);
      return [updated, ...rest];
    });
  }

  function applyUpdatedMessage(message: MessageItem) {
    setMessages((previous) =>
      previous.map((item) => (item.id === message.id ? message : item)),
    );

    setChats((previous) =>
      previous.map((chat) => {
        if (chat.id !== message.chatId || !chat.lastMessage) {
          return chat;
        }
        if (chat.lastMessage.id !== message.id) {
          return chat;
        }
        return {
          ...chat,
          lastMessage: message,
        };
      }),
    );

    if (message.isDeleted) {
      setReplyToMessage((previous) =>
        previous?.id === message.id ? null : previous,
      );
      setForwardSourceMessage((previous) =>
        previous?.id === message.id ? null : previous,
      );
      setEditingMessageId((previous) => (previous === message.id ? null : previous));
    }
  }

  function applyPinnedMessage(chatId: string, pinnedMessage: MessageReference | null) {
    setChats((previous) =>
      previous.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              pinnedMessage,
            }
          : chat,
      ),
    );
  }

  function showNotice(text: string) {
    setNotice(text);
    if (noticeTimeoutRef.current) {
      clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = setTimeout(() => {
      setNotice(null);
    }, 2600);
  }

  function jumpToMessage(messageId: string) {
    setHighlightedMessageId(messageId);
    const node = messageElementsRef.current[messageId];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    window.setTimeout(() => {
      setHighlightedMessageId((previous) =>
        previous === messageId ? null : previous,
      );
    }, 2200);
  }

  async function onSearchInChat(event: FormEvent) {
    event.preventDefault();
    if (!activeChatId) {
      return;
    }

    const query = searchInput.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const found = await searchMessages(activeChatId, query, 20);
      setSearchResults(found);
      if (found.length === 0) {
        showNotice('Ничего не найдено');
      }
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка поиска');
    } finally {
      setSearching(false);
    }
  }

  function onOpenSearchResult(message: MessageItem) {
    upsertLocalMessage(message);
    requestAnimationFrame(() => {
      jumpToMessage(message.id);
    });
  }

  async function onSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!activeChatId) {
      return;
    }

    const content = messageInput.trim();
    if (!content) {
      return;
    }

    setSending(true);
    setError(null);
    try {
      if (editingMessageId) {
        const updated = await updateMessage(activeChatId, editingMessageId, content);
        applyUpdatedMessage(updated);
        setEditingMessageId(null);
      } else {
        const created = await sendMessage(activeChatId, content, {
          replyToMessageId: replyToMessage?.id,
        });
        upsertLocalMessage(created);
      }
      setMessageInput('');
      setReplyToMessage(null);
      socketRef.current?.emit('typing', { chatId: activeChatId, isTyping: false });
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  }

  async function onUploadSelectedFile() {
    if (!activeChatId || !selectedFile) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const created = await uploadAttachment(activeChatId, selectedFile);
      upsertLocalMessage(created);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  }

  function onReply(message: MessageItem) {
    setReplyToMessage(message);
    setForwardSourceMessage(null);
    setEditingMessageId(null);
  }

  function onEditMessage(message: MessageItem) {
    if (message.isDeleted) {
      return;
    }
    setEditingMessageId(message.id);
    setReplyToMessage(null);
    setForwardSourceMessage(null);
    setMessageInput(message.content);
  }

  function onForwardSelect(message: MessageItem) {
    if (message.isDeleted) {
      return;
    }
    setForwardSourceMessage(message);
    setForwardTargetChatId(activeChatIdRef.current ?? null);
    setReplyToMessage(null);
    setEditingMessageId(null);
  }

  async function onDeleteMessage(message: MessageItem) {
    if (!activeChatId || message.isDeleted) {
      return;
    }

    setError(null);
    try {
      const updated = await deleteMessage(activeChatId, message.id);
      applyUpdatedMessage(updated);
      if (editingMessageId === message.id) {
        setEditingMessageId(null);
        setMessageInput('');
      }
      if (replyToMessage?.id === message.id) {
        setReplyToMessage(null);
      }
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка удаления сообщения');
    }
  }

  async function onForwardToActiveChat() {
    if (!forwardSourceMessage || !forwardTargetChatId) {
      return;
    }

    setError(null);
    try {
      const created = await forwardMessage(
        forwardSourceMessage.chatId,
        forwardSourceMessage.id,
        forwardTargetChatId,
      );
      if (forwardTargetChatId === activeChatIdRef.current) {
        upsertLocalMessage(created);
      } else {
        const targetChat = chats.find((chat) => chat.id === forwardTargetChatId);
        showNotice(
          `Переслано в "${targetChat ? chatTitle(targetChat) : 'другой чат'}"`,
        );
      }
      setForwardSourceMessage(null);
      setForwardTargetChatId(activeChatIdRef.current ?? null);
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка пересылки сообщения');
    }
  }

  async function onToggleReaction(message: MessageItem, emoji: string) {
    if (!activeChatId || message.isDeleted) {
      return;
    }

    setError(null);
    try {
      const updated = await toggleReaction(activeChatId, message.id, emoji);
      applyUpdatedMessage(updated);
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка реакции');
    }
  }

  async function onPinMessage(message: MessageItem) {
    if (!activeChatId || message.isDeleted) {
      return;
    }

    setError(null);
    try {
      const result = await pinMessage(activeChatId, message.id);
      applyPinnedMessage(activeChatId, result.pinnedMessage);
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка закрепления');
    }
  }

  async function onUnpinMessage() {
    if (!activeChatId) {
      return;
    }

    setError(null);
    try {
      await unpinMessage(activeChatId);
      applyPinnedMessage(activeChatId, null);
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Ошибка открепления');
    }
  }

  function stopRecorderStream() {
    for (const track of mediaRecorderStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    mediaRecorderStreamRef.current = null;
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
  }

  async function onStartRecording(mode: RecordingMode) {
    if (!activeChatIdRef.current || uploading || recordingMode) {
      return;
    }

    if (!canUseMediaDevices()) {
      setError('Запись голосовых и видеосообщений доступна только по HTTPS.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video',
      });

      const preferredTypes =
        mode === 'video'
          ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
          : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];
      const mimeType =
        preferredTypes.find((value) => MediaRecorder.isTypeSupported(value)) ?? '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorderChunksRef.current = [];
      mediaRecorderStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setRecordingMode(mode);
      setError(null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError('Ошибка записи сообщения');
      };

      recorder.onstop = async () => {
        const chatId = activeChatIdRef.current;
        const chunks = [...recorderChunksRef.current];
        recorderChunksRef.current = [];

        stopRecorderStream();
        mediaRecorderRef.current = null;
        setRecordingMode(null);

        if (!chatId || chunks.length === 0) {
          return;
        }

        const fallbackType = mode === 'video' ? 'video/webm' : 'audio/webm';
        const blobType = recorder.mimeType || fallbackType;
        const blob = new Blob(chunks, { type: blobType });
        if (blob.size === 0) {
          return;
        }

        const ext = blobType.includes('ogg') ? 'ogg' : 'webm';
        const fileNamePrefix = mode === 'video' ? 'video-note' : 'voice-message';
        const file = new File([blob], `${fileNamePrefix}-${Date.now()}.${ext}`, {
          type: blobType,
        });

        setUploading(true);
        try {
          const created = await uploadAttachment(chatId, file);
          upsertLocalMessage(created);
        } catch (rawError) {
          setError(rawError instanceof Error ? rawError.message : 'Ошибка отправки записи');
        } finally {
          setUploading(false);
        }
      };

      recorder.start(300);
    } catch (rawError) {
      stopRecorderStream();
      mediaRecorderRef.current = null;
      setRecordingMode(null);
      setError(toFriendlyMediaError(rawError));
    }
  }

  async function onStartCall(type: CallType) {
    if (!activeChatId || !socketRef.current || inCall) {
      return;
    }

    setCallInfo(type === 'video' ? 'Запуск видеозвонка...' : 'Запуск аудиозвонка...');
    try {
      currentCallChatIdRef.current = activeChatId;
      pendingIceCandidatesRef.current = [];
      const media = await requestLocalMedia(type);
      localStreamRef.current = media;
      remoteStreamRef.current = new MediaStream();
      setMediaRefs();

      const connection = createPeerConnection(activeChatId);
      for (const track of media.getTracks()) {
        connection.addTrack(track, media);
      }

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      socketRef.current.emit('call_offer', {
        chatId: activeChatId,
        sdp: offer,
        type,
      });

      setCallType(type);
      setInCall(true);
      setCallInfo('Ожидание ответа...');
    } catch (error) {
      cleanupCallState();
      setCallInfo(toFriendlyMediaError(error));
      setError(toFriendlyMediaError(error));
    }
  }

  async function onAcceptIncomingCall() {
    if (!incomingCall || !socketRef.current) {
      return;
    }

    try {
      currentCallChatIdRef.current = incomingCall.chatId;
      const media = await requestLocalMedia(incomingCall.type);
      localStreamRef.current = media;
      remoteStreamRef.current = new MediaStream();
      setMediaRefs();

      const connection = createPeerConnection(incomingCall.chatId);
      for (const track of media.getTracks()) {
        connection.addTrack(track, media);
      }

      await connection.setRemoteDescription(
        new RTCSessionDescription(incomingCall.sdp),
      );
      await flushPendingIceCandidates();
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);

      socketRef.current.emit('call_answer', {
        chatId: incomingCall.chatId,
        sdp: answer,
      });

      setCallType(incomingCall.type);
      setInCall(true);
      setIncomingCall(null);
      incomingCallRef.current = null;
      setCallInfo('Звонок установлен');
    } catch (error) {
      cleanupCallState();
      setCallInfo('Не удалось принять звонок');
      setError(toFriendlyMediaError(error));
    }
  }

  function onDeclineIncomingCall() {
    if (!incomingCall || !socketRef.current) {
      return;
    }
    socketRef.current.emit('call_end', { chatId: incomingCall.chatId });
    setIncomingCall(null);
    incomingCallRef.current = null;
    setCallInfo('Вызов отклонён');
  }

  function onEndCall() {
    if (!socketRef.current || !currentCallChatIdRef.current) {
      cleanupCallState();
      return;
    }
    socketRef.current.emit('call_end', { chatId: currentCallChatIdRef.current });
    setCallInfo('Звонок завершён');
    cleanupCallState();
  }

  function toggleMute() {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      return;
    }
    audioTrack.enabled = !audioTrack.enabled;
    setCallMuted(!audioTrack.enabled);
  }

  function toggleCamera() {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      return;
    }
    videoTrack.enabled = !videoTrack.enabled;
    setCallCameraEnabled(videoTrack.enabled);
  }

  async function onLogout() {
    onEndCall();
    stopRecording();
    stopRecorderStream();
    await logout();
    router.replace('/login');
  }

  function onTyping(nextValue: string) {
    setMessageInput(nextValue);
    if (!activeChatId || !socketRef.current) {
      return;
    }

    socketRef.current.emit('typing', { chatId: activeChatId, isTyping: true });
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit('typing', {
        chatId: activeChatId,
        isTyping: false,
      });
    }, 1200);
  }

  function chatTitle(chat: ChatItem) {
    return chat.peer?.displayName || chat.peer?.username || 'Личный чат';
  }

  function userTypingLabel() {
    if (typingUsers.length === 0) {
      return null;
    }

    const usernames = typingUsers
      .map((userId) => {
        if (userId === me?.id) {
          return me.displayName || me.username;
        }
        const chat = chats.find((item) => item.peer?.id === userId);
        return chat?.peer?.displayName || chat?.peer?.username || userId;
      })
      .join(', ');

    return `${usernames} печатает...`;
  }

  function formatStatus(userId?: string | null) {
    if (!userId) {
      return 'не в сети';
    }
    return presence[userId] === 'online' ? 'в сети' : 'не в сети';
  }

  function roleLabel(role: 'USER' | 'ADMIN') {
    return role === 'ADMIN' ? 'админ' : 'пользователь';
  }

  function formatSize(size: number) {
    if (size < 1024) {
      return `${size} Б`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} КБ`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
  }

  function messageAuthorLabel(message: MessageItem | MessageItem['replyToMessage']) {
    if (!message) {
      return 'Пользователь';
    }
    if (message.senderId === me?.id) {
      return 'Вы';
    }
    return message.sender.displayName || message.sender.username;
  }

  function messageSnippet(content: string) {
    const normalized = content.trim();
    if (!normalized) {
      return '[пусто]';
    }
    if (normalized.length <= 120) {
      return normalized;
    }
    return `${normalized.slice(0, 117)}...`;
  }

  function reactionSummary(message: MessageItem) {
    const counters = new Map<string, { count: number; own: boolean }>();
    for (const reaction of message.reactions ?? []) {
      const current = counters.get(reaction.emoji) ?? { count: 0, own: false };
      current.count += 1;
      if (reaction.userId === me?.id) {
        current.own = true;
      }
      counters.set(reaction.emoji, current);
    }
    return Array.from(counters.entries()).map(([emoji, value]) => ({
      emoji,
      count: value.count,
      own: value.own,
    }));
  }

  function renderAttachments(attachments?: AttachmentItem[]) {
    if (!attachments || attachments.length === 0) {
      return null;
    }
    return (
      <div className="attachments">
        {attachments.map((attachment) => {
          if (attachment.mimeType.startsWith('image/')) {
            return (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="attachment-image-link"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.url}
                  alt={attachment.fileName}
                  className="attachment-image"
                />
              </a>
            );
          }

          if (attachment.mimeType.startsWith('audio/')) {
            return (
              <div key={attachment.id} className="attachment-media">
                <audio controls preload="metadata" src={attachment.url} className="audio-player" />
                <span className="muted">{attachment.fileName}</span>
              </div>
            );
          }

          if (attachment.mimeType.startsWith('video/')) {
            const isVideoNote = attachment.fileName.startsWith('video-note-');
            return (
              <div key={attachment.id} className="attachment-media">
                <video
                  controls
                  preload="metadata"
                  src={attachment.url}
                  className={isVideoNote ? 'video-note-player' : 'video-player'}
                />
                <span className="muted">{attachment.fileName}</span>
              </div>
            );
          }

          return (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="attachment-link"
            >
              <strong>{attachment.fileName}</strong>
              <span>{formatSize(attachment.size)}</span>
            </a>
          );
        })}
      </div>
    );
  }

  if (loading) {
    return <main className="centered">Загрузка чатов...</main>;
  }

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar">
        <header className="sidebar-header">
          <div>
            <h2>Korbit</h2>
            {me ? (
              <p className="muted">
                {me.displayName || me.username} ({roleLabel(me.role)})
              </p>
            ) : null}
          </div>
          <button onClick={onLogout} type="button">
            Выйти
          </button>
        </header>

        <form onSubmit={onCreateChat} className="new-chat-form">
          <input
            value={newChatUsername}
            onChange={(event) => setNewChatUsername(event.target.value)}
            placeholder="Начать чат по логину"
          />
          <button type="submit" disabled={creatingChat}>
            {creatingChat ? '...' : 'Старт'}
          </button>
        </form>

        <div className="chat-list">
          {chats.map((chat) => (
            <button
              key={chat.id}
              className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}
              onClick={() => setActiveChatId(chat.id)}
              type="button"
            >
              <strong>{chatTitle(chat)}</strong>
              <span className="muted">{formatStatus(chat.peer?.id)}</span>
              <span className="preview">
                {chat.lastMessage?.content ?? 'Сообщений пока нет'}
              </span>
            </button>
          ))}
          {chats.length === 0 ? (
            <p className="muted">Чатов пока нет. Создай первый чат выше.</p>
          ) : null}
        </div>
      </aside>

      <section className="chat-main">
        {activeChat ? (
          <>
            <header className="chat-main-header">
              <h3>{chatTitle(activeChat)}</h3>
              <form className="chat-search" onSubmit={onSearchInChat}>
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Поиск по сообщениям"
                />
                <button type="submit" disabled={searching}>
                  {searching ? '...' : 'Найти'}
                </button>
              </form>
              <div className="call-actions">
                <span className="muted">{formatStatus(activeChat.peer?.id)}</span>
                <button
                  type="button"
                  onClick={() => onStartCall('audio')}
                  disabled={inCall || !canUseMediaDevices()}
                >
                  Аудио
                </button>
                <button
                  type="button"
                  onClick={() => onStartCall('video')}
                  disabled={inCall || !canUseMediaDevices()}
                >
                  Видео
                </button>
              </div>
            </header>

            {activeChat.pinnedMessage ? (
              <section className="pinned-banner">
                <div>
                  <strong>
                    Закреп: {messageAuthorLabel(activeChat.pinnedMessage)}
                  </strong>
                  <p>
                    {activeChat.pinnedMessage.isDeleted
                      ? 'Сообщение удалено'
                      : messageSnippet(activeChat.pinnedMessage.content)}
                  </p>
                </div>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void onUnpinMessage()}
                >
                  Открепить
                </button>
              </section>
            ) : null}

            {searchInput.trim() ? (
              <section className="search-results">
                <div className="search-results-header">
                  <strong>Результаты поиска</strong>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setSearchInput('');
                      setSearchResults([]);
                    }}
                  >
                    Скрыть
                  </button>
                </div>
                {searchResults.length === 0 ? (
                  <p className="muted">Совпадений пока нет</p>
                ) : (
                  <div className="search-results-list">
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="search-result-item"
                        onClick={() => onOpenSearchResult(result)}
                      >
                        <strong>{messageAuthorLabel(result)}</strong>
                        <span>{messageSnippet(result.content)}</span>
                        <small>{new Date(result.createdAt).toLocaleString()}</small>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {!canUseMediaDevices() ? (
              <p className="muted">
                Звонки доступны только по HTTPS. Сейчас открыт небезопасный режим.
              </p>
            ) : null}

            {(incomingCall || inCall || callInfo) && (
              <section className="call-panel">
                {incomingCall ? (
                  <div className="call-row">
                    <span>
                      Входящий {incomingCall.type === 'video' ? 'видеозвонок' : 'аудиозвонок'}
                    </span>
                    <button type="button" onClick={onAcceptIncomingCall}>
                      Принять
                    </button>
                    <button type="button" onClick={onDeclineIncomingCall}>
                      Отклонить
                    </button>
                  </div>
                ) : null}

                {inCall ? (
                  <div className="call-row">
                    <span>Звонок активен ({callType === 'video' ? 'видео' : 'аудио'})</span>
                    <button type="button" onClick={toggleMute}>
                      {callMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                    </button>
                    {callType === 'video' ? (
                      <button type="button" onClick={toggleCamera}>
                        {callCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
                      </button>
                    ) : null}
                    <button type="button" onClick={onEndCall}>
                      Завершить
                    </button>
                  </div>
                ) : null}

                {callInfo ? <p className="muted">{callInfo}</p> : null}

                {inCall ? (
                  <div className="video-grid">
                    <figure className="video-tile">
                      <video ref={remoteVideoRef} autoPlay playsInline className="video-box" />
                      <figcaption className="video-label">
                        {activeChat.peer?.displayName ||
                          activeChat.peer?.username ||
                          'Собеседник'}
                      </figcaption>
                    </figure>
                    <figure className="video-tile">
                      <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="video-box"
                      />
                      <figcaption className="video-label">
                        {me?.displayName || me?.username || 'Вы'}
                      </figcaption>
                    </figure>
                  </div>
                ) : null}
              </section>
            )}

            <div className="messages">
              {messages.map((message) => {
                const own = message.senderId === me?.id;
                const canManage = own || me?.role === 'ADMIN';
                const reactionsView = reactionSummary(message);
                return (
                  <article
                    key={message.id}
                    ref={(element) => {
                      messageElementsRef.current[message.id] = element;
                    }}
                    className={`message ${own ? 'own' : 'peer'} ${
                      highlightedMessageId === message.id ? 'highlighted-message' : ''
                    }`}
                  >
                    {message.forwardedFromMessage ? (
                      <div className="message-meta-quote">
                        <strong>
                          Переслано от {messageAuthorLabel(message.forwardedFromMessage)}
                        </strong>
                        <span>
                          {message.forwardedFromMessage.isDeleted
                            ? 'Сообщение удалено'
                            : messageSnippet(message.forwardedFromMessage.content)}
                        </span>
                      </div>
                    ) : null}

                    {message.replyToMessage ? (
                      <div className="message-meta-quote">
                        <strong>Ответ для {messageAuthorLabel(message.replyToMessage)}</strong>
                        <span>
                          {message.replyToMessage.isDeleted
                            ? 'Сообщение удалено'
                            : messageSnippet(message.replyToMessage.content)}
                        </span>
                      </div>
                    ) : null}

                    <p>{message.content}</p>
                    {renderAttachments(message.attachments)}

                    {reactionsView.length > 0 ? (
                      <div className="reaction-list">
                        {reactionsView.map((item) => (
                          <button
                            key={item.emoji}
                            type="button"
                            className={`reaction-chip ${item.own ? 'own' : ''}`}
                            onClick={() => void onToggleReaction(message, item.emoji)}
                          >
                            <span>{item.emoji}</span>
                            <small>{item.count}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="message-actions">
                      {!message.isDeleted ? (
                        <div className="quick-reactions">
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="link-button"
                              onClick={() => void onToggleReaction(message, emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onReply(message)}
                        disabled={message.isDeleted}
                      >
                        Ответить
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onForwardSelect(message)}
                        disabled={message.isDeleted}
                      >
                        Переслать
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void onPinMessage(message)}
                        disabled={message.isDeleted}
                      >
                        Закрепить
                      </button>
                      {canManage ? (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onEditMessage(message)}
                          disabled={message.isDeleted}
                        >
                          Изменить
                        </button>
                      ) : null}
                      {canManage ? (
                        <button
                          type="button"
                          className="link-button danger-link"
                          onClick={() => void onDeleteMessage(message)}
                          disabled={message.isDeleted}
                        >
                          Удалить
                        </button>
                      ) : null}
                    </div>

                    <small>
                      {messageAuthorLabel(message)}
                      {message.editedAt ? ' (изменено)' : ''} |{' '}
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </small>
                  </article>
                );
              })}
            </div>

            <div className="typing-indicator">{userTypingLabel()}</div>

            {replyToMessage ? (
              <div className="composer-context">
                <div>
                  <strong>Ответ на {messageAuthorLabel(replyToMessage)}</strong>
                  <p>{messageSnippet(replyToMessage.content)}</p>
                </div>
                <button type="button" className="link-button" onClick={() => setReplyToMessage(null)}>
                  Отменить
                </button>
              </div>
            ) : null}

            {editingMessageId ? (
              <div className="composer-context">
                <div>
                  <strong>Редактирование сообщения</strong>
                  <p>После сохранения участники увидят пометку "изменено"</p>
                </div>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setEditingMessageId(null);
                    setMessageInput('');
                  }}
                >
                  Отменить
                </button>
              </div>
            ) : null}

            {forwardSourceMessage ? (
              <div className="composer-context">
                <div>
                  <strong>
                    Пересылка от {messageAuthorLabel(forwardSourceMessage)}
                  </strong>
                  <p>{messageSnippet(forwardSourceMessage.content)}</p>
                </div>
                <div className="composer-context-actions">
                  <label className="forward-target-field">
                    <span className="muted">Куда</span>
                    <select
                      className="forward-target-select"
                      value={forwardTargetChatId ?? ''}
                      onChange={(event) =>
                        setForwardTargetChatId(event.target.value || null)
                      }
                    >
                      <option value="" disabled>
                        Выберите чат
                      </option>
                      {chats.map((chat) => (
                        <option key={chat.id} value={chat.id}>
                          {chatTitle(chat)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void onForwardToActiveChat()}
                    disabled={uploading || !forwardTargetChatId}
                  >
                    {forwardTargetChatId === activeChatId ? 'Переслать сюда' : 'Переслать'}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setForwardSourceMessage(null)}
                  >
                    Отменить
                  </button>
                </div>
              </div>
            ) : null}

            <div className="composer-attachments">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden-file-input"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                Прикрепить файл
              </button>
              <button
                type="button"
                onClick={() => onStartRecording('audio')}
                disabled={uploading || Boolean(recordingMode)}
              >
                Голосовое
              </button>
              <button
                type="button"
                onClick={() => onStartRecording('video')}
                disabled={uploading || Boolean(recordingMode)}
              >
                Кружок
              </button>
              {recordingMode ? (
                <>
                  <span className="muted">
                    Идёт запись {recordingMode === 'audio' ? 'голосового' : 'кружка'}
                  </span>
                  <button type="button" onClick={stopRecording}>
                    Остановить и отправить
                  </button>
                </>
              ) : null}
              {selectedFile ? (
                <>
                  <span className="muted">{selectedFile.name}</span>
                  <button type="button" onClick={onUploadSelectedFile} disabled={uploading}>
                    {uploading ? 'Загрузка...' : 'Отправить файл'}
                  </button>
                </>
              ) : null}
            </div>

            <form onSubmit={onSendMessage} className="composer">
              <input
                value={messageInput}
                onChange={(event) => onTyping(event.target.value)}
                placeholder={
                  editingMessageId
                    ? 'Измените сообщение...'
                    : 'Введите сообщение...'
                }
                disabled={sending}
              />
              <button type="submit" disabled={sending || !messageInput.trim()}>
                {editingMessageId ? 'Сохранить' : 'Отправить'}
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat">
            <h3>Чат не выбран</h3>
            <p className="muted">Создай личный чат в левой панели.</p>
          </div>
        )}
      </section>

      {notice ? (
        <p className={`floating-notice ${error ? 'with-error' : ''}`}>{notice}</p>
      ) : null}
      {error ? <p className="error floating-error">{error}</p> : null}
    </main>
  );
}
