'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  ApiError,
  createDirectChat,
  getApiBaseUrl,
  getMe,
  isAuthenticated,
  listChats,
  listMessages,
  logout,
  markRead,
  sendMessage,
} from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { ChatItem, MessageItem, UserProfile } from '../../lib/types';

type PresenceState = Record<string, 'online' | 'offline'>;

export default function ChatsPage() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeChatIdRef = useRef<string | null>(null);

  const [me, setMe] = useState<UserProfile | null>(null);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [newChatUsername, setNewChatUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [creatingChat, setCreatingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [presence, setPresence] = useState<PresenceState>({});

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [activeChatId, chats],
  );

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
        setError(rawError instanceof Error ? rawError.message : 'Load failed');
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
        setError(
          rawError instanceof Error ? rawError.message : 'Message load failed',
        );
      }
    };

    void loadMessages();
  }, [activeChatId]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    const socket = io(`${getApiBaseUrl()}/realtime`, {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on(
      'presence_snapshot',
      (snapshot: Array<{ userId: string; status: 'online' | 'offline' }>) => {
        const next: PresenceState = {};
        for (const item of snapshot) {
          next[item.userId] = item.status;
        }
        setPresence(next);
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
        if (event.chatId !== activeChatIdRef.current) {
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

    socket.on('connect_error', () => {
      setError('Realtime connection error');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
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
      setError(rawError instanceof Error ? rawError.message : 'Chat create failed');
    } finally {
      setCreatingChat(false);
    }
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
      await sendMessage(activeChatId, content);
      setMessageInput('');
      socketRef.current?.emit('typing', { chatId: activeChatId, isTyping: false });
    } catch (rawError) {
      setError(rawError instanceof Error ? rawError.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  async function onLogout() {
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
    return chat.peer?.displayName || chat.peer?.username || 'Direct chat';
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

    return `${usernames} typing...`;
  }

  if (loading) {
    return <main className="centered">Loading chats...</main>;
  }

  return (
    <main className="chat-shell">
      <aside className="chat-sidebar">
        <header className="sidebar-header">
          <div>
            <h2>Korbit</h2>
            {me ? (
              <p className="muted">
                {me.displayName || me.username} ({me.role.toLowerCase()})
              </p>
            ) : null}
          </div>
          <button onClick={onLogout} type="button">
            Log out
          </button>
        </header>

        <form onSubmit={onCreateChat} className="new-chat-form">
          <input
            value={newChatUsername}
            onChange={(event) => setNewChatUsername(event.target.value)}
            placeholder="Start direct chat by username"
          />
          <button type="submit" disabled={creatingChat}>
            {creatingChat ? '...' : 'Start'}
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
              <span className="muted">
                {chat.peer && presence[chat.peer.id] === 'online'
                  ? 'online'
                  : 'offline'}
              </span>
              <span className="preview">
                {chat.lastMessage?.content ?? 'No messages yet'}
              </span>
            </button>
          ))}
          {chats.length === 0 ? (
            <p className="muted">No chats yet. Start one above.</p>
          ) : null}
        </div>
      </aside>

      <section className="chat-main">
        {activeChat ? (
          <>
            <header className="chat-main-header">
              <h3>{chatTitle(activeChat)}</h3>
              <span className="muted">
                {activeChat.peer && presence[activeChat.peer.id] === 'online'
                  ? 'online'
                  : 'offline'}
              </span>
            </header>

            <div className="messages">
              {messages.map((message) => {
                const own = message.senderId === me?.id;
                return (
                  <article
                    key={message.id}
                    className={`message ${own ? 'own' : 'peer'}`}
                  >
                    <p>{message.content}</p>
                    <small>
                      {message.sender.displayName || message.sender.username} |{' '}
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </small>
                  </article>
                );
              })}
            </div>

            <div className="typing-indicator">{userTypingLabel()}</div>

            <form onSubmit={onSendMessage} className="composer">
              <input
                value={messageInput}
                onChange={(event) => onTyping(event.target.value)}
                placeholder="Write message..."
                disabled={sending}
              />
              <button type="submit" disabled={sending || !messageInput.trim()}>
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat">
            <h3>No chat selected</h3>
            <p className="muted">Create a direct chat from the sidebar.</p>
          </div>
        )}
      </section>

      {error ? <p className="error floating-error">{error}</p> : null}
    </main>
  );
}

