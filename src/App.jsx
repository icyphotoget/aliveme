import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import LoveOverlay from "./LoveOverlay";
import ExplosionOverlay from "./ExplosionOverlay";

const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "😡"];

// ----------------------
// ROOT APP – AUTH GATE
// ----------------------
function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    let authSub;

    async function loadSession() {
      const { data } = await supabase.auth.getSession();
      setSession(data.session || null);
      setLoadingSession(false);

      const { data: subscription } = supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          setSession(newSession || null);
          setLoadingSession(false);
        }
      );

      authSub = subscription;
    }

    loadSession();

    return () => {
      if (authSub) authSub.subscription.unsubscribe();
    };
  }, []);

  if (loadingSession) {
    return (
      <div className="app-container mood-neutral">
        <div className="chat-window inbox-window">
          <div className="chat-header">
            <h2>Alive Chat</h2>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              opacity: 0.8,
            }}
          >
            Učitavam...
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return <ChatApp session={session} />;
}

// ----------------------
// CHAT APP (INBOX + ROOMS)
// ----------------------
function ChatApp({ session }) {
  // "lijepo" ime za usera – mail bez @domena ili dio id-a
  const user = session.user;
  const userId =
    (user?.email && user.email.split("@")[0]) ||
    (user?.id ? user.id.slice(0, 8) : "user");

  const [messages, setMessages] = useState([]);
  const [activeEffect, setActiveEffect] = useState(null);
  const [showExplosion, setShowExplosion] = useState(false);

  const [text, setText] = useState("");
  const [mood, setMood] = useState("normal");

  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");

  const [conversations, setConversations] = useState([]);
  const [reactionsByMessage, setReactionsByMessage] = useState({});
  const [showReactionPickerFor, setShowReactionPickerFor] = useState(null);

  const [typingUsers, setTypingUsers] = useState([]);
  const typingChannelRef = useRef(null);

  const [chatMood, setChatMood] = useState("neutral");

  // ----------------------
  // URL → ROOM
  // ----------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r) {
      setRoomId(r);
      setRoomInput(r);
    }
  }, []);

  function setRoomAndUrl(newRoomId) {
    setRoomId(newRoomId);
    const params = new URLSearchParams(window.location.search);
    if (newRoomId) params.set("room", newRoomId);
    else params.delete("room");

    const newUrl =
      window.location.pathname +
      (params.toString() ? "?" + params.toString() : "");
    window.history.replaceState({}, "", newUrl);
  }

  // ----------------------
  // INBOX – LISTA RAZGOVORA
  // ----------------------
  useEffect(() => {
    async function loadConversations() {
      const { data, error } = await supabase
        .from("messages")
        .select("conversation_id, text, sender_id, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("loadConversations error", error);
        return;
      }

      const seen = new Set();
      const convs = [];

      (data || []).forEach((m) => {
        if (!seen.has(m.conversation_id)) {
          seen.add(m.conversation_id);
          convs.push({
            id: m.conversation_id,
            lastMessage: m.text,
            lastSender: m.sender_id,
            lastAt: m.created_at,
          });
        }
      });

      setConversations(convs);
    }

    loadConversations();
  }, []);

  function updateConversationsWithMessage(msg) {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === msg.conversation_id);
      const updated = {
        id: msg.conversation_id,
        lastMessage: msg.text,
        lastSender: msg.sender_id,
        lastAt: msg.created_at,
      };

      if (idx === -1) {
        return [updated, ...prev];
      }

      const copy = [...prev];
      copy.splice(idx, 1);
      return [updated, ...copy];
    });
  }

  // ----------------------
  // PORUKE U AKTIVNOJ SOBI
  // ----------------------
  useEffect(() => {
    if (!roomId) {
      setMessages([]);
      return;
    }

    async function loadMessages() {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", roomId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("loadMessages error", error);
      } else {
        setMessages(data || []);
      }
    }

    loadMessages();
  }, [roomId]);

  // global realtime za messages – i inbox i otvorena soba
  useEffect(() => {
    const channel = supabase
      .channel("messages-all")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new;

          // update otvorene sobe
          setMessages((prev) =>
            msg.conversation_id === roomId ? [...prev, msg] : prev
          );

          // update inbox liste
          updateConversationsWithMessage(msg);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // ----------------------
  // EFFECTS (LOVE)
  // ----------------------
  useEffect(() => {
    if (!roomId) return;

    const channel = supabase
      .channel(`effects-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "effects" },
        (payload) => {
          if (payload.new.conversation_id === roomId) {
            setActiveEffect(payload.new);
            setTimeout(() => setActiveEffect(null), 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // ----------------------
  // REACTIONS
  // ----------------------
  useEffect(() => {
    if (!roomId) {
      setReactionsByMessage({});
      return;
    }

    async function loadReactions() {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", roomId);

      if (error) {
        console.error("loadReactions error", error);
        return;
      }

      const map = {};
      (data || []).forEach((r) => {
        if (!map[r.message_id]) map[r.message_id] = [];
        map[r.message_id].push(r);
      });
      setReactionsByMessage(map);
    }

    loadReactions();

    const channel = supabase
      .channel(`reactions-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const r = payload.new;
          if (r.conversation_id !== roomId) return;

          setReactionsByMessage((prev) => {
            const e = prev[r.message_id] || [];
            return { ...prev, [r.message_id]: [...e, r] };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // ----------------------
  // TYPING indikator
  // ----------------------
  useEffect(() => {
    if (!roomId || !userId) return;

    const channel = supabase.channel(`typing-${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const otherUser = payload.userId;
        if (!otherUser || otherUser === userId) return;

        setTypingUsers((prev) =>
          prev.includes(otherUser) ? prev : [...prev, otherUser]
        );

        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u !== otherUser));
        }, 2000);
      })
      .subscribe();

    typingChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [roomId, userId]);

  // ----------------------
  // LJUTE PORUKE → EKSPLOZIJA
  // ----------------------
  useEffect(() => {
    if (!userId || !roomId || messages.length === 0) return;

    const angryFromOthers = messages.filter(
      (m) => m.mood === "angry" && m.sender_id !== userId
    );

    if (angryFromOthers.length === 0) return;

    const latest = angryFromOthers[angryFromOthers.length - 1];
    const key = `lastExploded_${roomId}_${userId}`;
    const lastExplodedId = localStorage.getItem(key);

    if (lastExplodedId === String(latest.id)) return;

    setShowExplosion(true);
    localStorage.setItem(key, latest.id);
    setTimeout(() => setShowExplosion(false), 2000);
  }, [userId, roomId, messages]);

  // ----------------------
  // CHAT MOOD ENGINE
  // ----------------------
  useEffect(() => {
    if (!messages.length) {
      setChatMood("neutral");
      return;
    }

    const recent = messages.slice(-15);
    let angry = 0;
    let soft = 0;

    recent.forEach((m) => {
      if (m.mood === "angry") angry++;
      if (m.mood === "soft") soft++;
    });

    let mood = "neutral";
    if (angry >= soft + 2 && angry >= 2) mood = "angry";
    else if (soft >= angry && soft >= 2) mood = "soft";

    setChatMood(mood);
  }, [messages]);

  // ----------------------
  // SLANJE PORUKA
  // ----------------------
  function getMessageTypeFromText(t) {
    const n = t.toLowerCase().trim();
    if (n === "volim te" || n.startsWith("volim te")) return "love";
    return "normal";
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!text.trim() || !userId || !roomId) return;

    const type = getMessageTypeFromText(text);

    const { error } = await supabase.from("messages").insert({
      conversation_id: roomId,
      sender_id: userId,
      text,
      type,
      mood,
    });

    if (error) {
      console.error("sendMessage error", error);
      return;
    }

    setText("");

    if (type === "love") {
      const { data: lastMessages } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", roomId)
        .order("created_at", { ascending: false })
        .limit(2);

      if (lastMessages && lastMessages.length === 2) {
        const [last, prev] = lastMessages;

        const bothLove =
          last.type === "love" &&
          prev.type === "love" &&
          last.sender_id !== prev.sender_id;

        const within5min =
          new Date(last.created_at).getTime() -
            new Date(prev.created_at).getTime() <
          5 * 60 * 1000;

        if (bothLove && within5min) {
          await supabase.from("effects").insert({
            conversation_id: roomId,
            type: "love_pair",
            payload: {},
          });
        }
      }
    }
  }

  function notifyTyping() {
    if (!typingChannelRef.current || !userId) return;
    typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId },
    });
  }

  // ----------------------
  // REACTIONS
  // ----------------------
  async function handleReactionClick(messageId, emoji) {
    if (!roomId || !userId) return;
    setShowReactionPickerFor(null);

    const { error } = await supabase.from("message_reactions").insert({
      conversation_id: roomId,
      message_id: messageId,
      user_id: userId,
      emoji,
    });

    if (error) {
      console.error("reaction error", error);
    }
  }

  // ----------------------
  // ROOMS UTIL
  // ----------------------
  function generateRoomId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "room-";
    for (let i = 0; i < 6; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function handleJoinRoom(e) {
    e.preventDefault();
    if (!roomInput.trim()) return;
    setRoomAndUrl(roomInput.trim());
  }

  function handleCreateRandomRoom() {
    const id = generateRoomId();
    setRoomInput(id);
    setRoomAndUrl(id);
  }

  function handleOpenConversation(id) {
    setRoomAndUrl(id);
  }

  function handleBackToInbox() {
    setRoomAndUrl("");
    setMessages([]);
    setReactionsByMessage({});
    setTypingUsers([]);
  }

  const typingText =
    typingUsers.length === 1
      ? `${typingUsers[0]} tipka…`
      : typingUsers.length > 1
      ? `${typingUsers.join(", ")} tipkaju…`
      : "";

  // ----------------------
  // INBOX EKRAN
  // ----------------------
  if (!roomId) {
    return (
      <div className={`app-container mood-${chatMood}`}>
        <div className="chat-window inbox-window">
          <div className="chat-header">
            <h2>Alive Chat</h2>
            <div className="user-tag">👤 {userId}</div>
          </div>

          <div className="inbox-body">
            <div className="inbox-top">
              <button
                className="primary-btn"
                type="button"
                onClick={handleCreateRandomRoom}
              >
                + Nova random soba
              </button>
            </div>

            <form className="room-form" onSubmit={handleJoinRoom}>
              <input
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="Upiši ID sobe (npr. ekipa, date-night...)"
              />
              <button type="submit">Join</button>
            </form>

            <div className="inbox-list-header">Razgovori</div>

            <div className="conversation-list">
              {conversations.length === 0 && (
                <div className="conversation-empty">
                  Još nema poruka. Kreiraj prvu sobu. ✨
                </div>
              )}

              {conversations.map((c) => (
                <button
                  key={c.id}
                  className="conversation-item"
                  type="button"
                  onClick={() => handleOpenConversation(c.id)}
                >
                  <div className="conversation-title">{c.id}</div>
                  <div className="conversation-preview">
                    {c.lastSender}: {c.lastMessage}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------
  // CHAT EKRAN
  // ----------------------
  return (
    <div className={`app-container mood-${chatMood}`}>
      <div className="chat-window">
        <div className="chat-header chat-header-chat">
          <div className="chat-header-left">
            <button
              type="button"
              className="back-button"
              onClick={handleBackToInbox}
            >
              ←
            </button>
            <div>
              <h2>Alive Chat</h2>
              <div className="room-tag">Room: {roomId}</div>
              <div className={`mood-pill mood-pill-${chatMood}`}>
                {chatMood === "angry"
                  ? "🔥 Spicy chat"
                  : chatMood === "soft"
                  ? "💗 Soft vibes"
                  : "🌙 Neutral"}
              </div>
            </div>
          </div>
          <div className="user-tag">👤 {userId}</div>
        </div>

        <div className="messages-area">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isMe={m.sender_id === userId}
              reactions={reactionsByMessage[m.id] || []}
              onOpenReactions={() => setShowReactionPickerFor(m.id)}
            />
          ))}
        </div>

        {typingText && <div className="typing-indicator">{typingText}</div>}

        <form className="input-bar" onSubmit={sendMessage}>
          <select value={mood} onChange={(e) => setMood(e.target.value)}>
            <option value="normal">🙂</option>
            <option value="soft">💕</option>
            <option value="angry">😡</option>
          </select>

          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              notifyTyping();
            }}
            placeholder="Napiši poruku..."
          />
          <button type="submit">➤</button>
        </form>
      </div>

      {showReactionPickerFor && (
        <div className="reaction-picker">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleReactionClick(showReactionPickerFor, emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {activeEffect?.type === "love_pair" && <LoveOverlay />}
      {showExplosion && <ExplosionOverlay />}
    </div>
  );
}

// ----------------------
// MESSAGE BUBBLE
// ----------------------
function MessageBubble({ message, isMe, reactions, onOpenReactions }) {
  const counts = reactions.reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {});

  return (
    <div
      className={`bubble ${isMe ? "me" : "them"} ${message.mood}`}
      onClick={onOpenReactions}
    >
      {!isMe && <div className="sender">{message.sender_id}</div>}
      <div>{message.text}</div>

      {Object.keys(counts).length > 0 && (
        <div className="reactions-row">
          {Object.entries(counts).map(([emoji, count]) => (
            <span key={emoji} className="reaction-pill">
              {emoji} {count > 1 && <span>{count}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------
// AUTH SCREEN
// ----------------------
function AuthScreen() {
  const [mode, setMode] = useState("signIn"); // "signIn" | "signUp"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "signIn") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        alert("Provjeri mail (ako je ukljuđen potvrđujući mail u Supabase-u).");
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Nešto je pošlo po zlu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-container mood-neutral">
      <div className="chat-window inbox-window">
        <div className="chat-header">
          <h2>Alive Chat</h2>
        </div>

        <div className="inbox-body">
          <h3>{mode === "signIn" ? "Prijava" : "Registracija"}</h3>
          <p className="room-sub">
            {mode === "signIn"
              ? "Ulogiraj se sa svojim mailom."
              : "Napravi račun za Alive Chat."}
          </p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Lozinka"
              autoComplete={
                mode === "signIn" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              className="primary-btn auth-submit"
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Pričekaj..."
                : mode === "signIn"
                ? "Prijavi se"
                : "Registriraj se"}
            </button>
          </form>

          {error && <div className="auth-error">{error}</div>}

          <div className="auth-switch">
            {mode === "signIn" ? "Nemaš račun?" : "Već imaš račun?"}{" "}
            <button
              type="button"
              onClick={() =>
                setMode((m) => (m === "signIn" ? "signUp" : "signIn"))
              }
            >
              {mode === "signIn" ? "Registriraj se" : "Prijavi se"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
