'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  ApiError,
  createDirectChat,
  getMe,
  getSocketConfig,
  isAuthenticated,
  listChats,
  listMessages,
  logout,
  markRead,
  sendMessage,
  uploadAttachment,
} from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AttachmentItem, ChatItem, MessageItem, UserProfile } from '../../lib/types';

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

export default function ChatsPage() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const currentCallChatIdRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

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

  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callType, setCallType] = useState<CallType | null>(null);
  const [inCall, setInCall] = useState(false);
  const [callMuted, setCallMuted] = useState(false);
  const [callCameraEnabled, setCallCameraEnabled] = useState(true);
  const [callInfo, setCallInfo] = useState<string | null>(null);

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

  function setMediaRefs() {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
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
    currentCallChatIdRef.current = null;
    setIncomingCall(null);
    setInCall(false);
    setCallType(null);
    setCallMuted(false);
    setCallCameraEnabled(true);
    setMediaRefs();
  }

  function createPeerConnection(chatId: string) {
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
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
      remoteStreamRef.current = event.streams[0];
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
            if (previous.some((item) => item.id === message.id)) {
              return previous;
            }
            return [...previous, message];
          });
          void markRead(message.chatId, message.id).catch(() => undefined);
        }
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

    socket.on('call_offer', (event: CallOfferEvent) => {
      if (event.senderId === me?.id) {
        return;
      }
      setIncomingCall(event);
      setCallInfo('Входящий звонок');
    });

    socket.on('call_answer', async (event: CallAnswerEvent) => {
      if (event.senderId === me?.id || !peerConnectionRef.current) {
        return;
      }
      if (event.chatId !== currentCallChatIdRef.current) {
        return;
      }
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(event.sdp),
      );
      setInCall(true);
      setCallInfo('Звонок установлен');
    });

    socket.on('call_ice_candidate', async (event: IceCandidateEvent) => {
      if (event.senderId === me?.id || !peerConnectionRef.current) {
        return;
      }
      if (event.chatId !== currentCallChatIdRef.current) {
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
      if (previous.some((item) => item.id === message.id)) {
        return previous;
      }
      return [...previous, message];
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
      const created = await sendMessage(activeChatId, content);
      upsertLocalMessage(created);
      setMessageInput('');
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

  async function onStartCall(type: CallType) {
    if (!activeChatId || !socketRef.current || inCall) {
      return;
    }

    setCallInfo(type === 'video' ? 'Запуск видеозвонка...' : 'Запуск аудиозвонка...');
    try {
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

      currentCallChatIdRef.current = activeChatId;
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
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);

      socketRef.current.emit('call_answer', {
        chatId: incomingCall.chatId,
        sdp: answer,
      });

      currentCallChatIdRef.current = incomingCall.chatId;
      setCallType(incomingCall.type);
      setInCall(true);
      setIncomingCall(null);
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

  function renderAttachments(attachments?: AttachmentItem[]) {
    if (!attachments || attachments.length === 0) {
      return null;
    }
    return (
      <div className="attachments">
        {attachments.map((attachment) => {
          const isImage = attachment.mimeType.startsWith('image/');
          if (isImage) {
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
                    <video ref={remoteVideoRef} autoPlay playsInline className="video-box" />
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="video-box"
                    />
                  </div>
                ) : null}
              </section>
            )}

            <div className="messages">
              {messages.map((message) => {
                const own = message.senderId === me?.id;
                return (
                  <article
                    key={message.id}
                    className={`message ${own ? 'own' : 'peer'}`}
                  >
                    <p>{message.content}</p>
                    {renderAttachments(message.attachments)}
                    <small>
                      {message.sender.displayName || message.sender.username} |{' '}
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </small>
                  </article>
                );
              })}
            </div>

            <div className="typing-indicator">{userTypingLabel()}</div>

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
                placeholder="Введите сообщение..."
                disabled={sending}
              />
              <button type="submit" disabled={sending || !messageInput.trim()}>
                Отправить
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

      {error ? <p className="error floating-error">{error}</p> : null}
    </main>
  );
}
