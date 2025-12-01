import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import LoveOverlay from "./LoveOverlay";
import ExplosionOverlay from "./ExplosionOverlay";

const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "😡"];

function App() {
  const [messages, setMessages] = useState([]);
  const [activeEffect, setActiveEffect] = useState(null);
  const [showExplosion, setShowExplosion] = useState(false);

  const [text, setText] = useState("");
  const [mood, setMood] = useState("normal");
  const [userId, setUserId] = useState("");

  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");

  // reactions: messageId -> array of reactions
  const [reactionsByMessage, setReactionsByMessage] = useState({});
  const [showReactionPickerFor, setShowReactionPickerFor] = useState(null);

  // typing indicator
  const [typingUsers, setTypingUsers] = useState([]);
  const typingChannelRef = useRef(null);

  // 1) user ime
  useEffect(() => {
    const name = prompt("Upiši svoje ime / nadimak:");
    setUserId(name || "anon");
  }, []);

  // 2) room iz URL-a ( ?room=xxx )
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
    params.set("room", newRoomId);
    const newUrl =
      window.location.pathname + "?" + params.toString() + window.location.hash;
    window.history.replaceState({}, "", newUrl);
  }

  // 3) messages realtime po sobi
  useEffect(() => {
    if (!roomId) return;

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

    const channel = supabase
      .channel(`messages-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          if (payload.new.conversation_id === roomId) {
            setMessages((prev) => [...prev, payload.new]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // 4) effects realtime (love animacija)
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

  // 5) reactions realtime
  useEffect(() => {
    if (!roomId) return;

    async function loadReactions() {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", roomId)
        .order("created_at", { ascending: true });

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
            const existing = prev[r.message_id] || [];
            return { ...prev, [r.message_id]: [...existing, r] };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // 6) typing indikator – broadcast kanal, bez baze
  useEffect(() => {
    if (!roomId || !userId) return;

    const channel = supabase.channel(`typing-${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const otherUser = payload.userId;
        if (!otherUser || otherUser === userId) return;

        setTypingUsers((prev) => {
          if (prev.includes(otherUser)) return prev;
          return [...prev, otherUser];
        });

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

  // 7) ljuta poruka -> eksplozija
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

  function getMessageTypeFromText(t) {
    const n = t.toLowerCase().trim();
    if (n === "volim te" || n === "volim te ❤️") return "love";
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

  // slanje "tipkam" signala
  function notifyTyping() {
    if (!typingChannelRef.current || !userId) return;
    typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId },
    });
  }

  // reakcije
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

  // random room id
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

  // ekran za odabir sobe
  if (!roomId) {
    return (
      <div className="app-container">
        <div className="chat-window room-screen">
          <div className="chat-header">
            <h2>Alive Chat</h2>
            <div className="user-tag">👤 {userId}</div>
          </div>

          <div className="room-body">
            <h3>Odaberi sobu</h3>
            <p className="room-sub">
              Upiši kod sobe ili stvori novu i pošalji link ekipi.
            </p>

            <form className="room-form" onSubmit={handleJoinRoom}>
              <input
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                placeholder="npr. ekipa, date-night, room-4f8a2c..."
              />
              <button type="submit">Join</button>
            </form>

            <div className="room-divider">ili</div>

            <button
              className="room-random-btn"
              type="button"
              onClick={handleCreateRandomRoom}
            >
              🎲 Kreiraj random sobu
            </button>

            <p className="room-hint">
              Kad uđeš u sobu, samo kopiraj URL i pošalji ga drugima.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const typingText =
    typingUsers.length === 1
      ? `${typingUsers[0]} tipka...`
      : typingUsers.length > 1
      ? `${typingUsers.join(", ")} tipkaju...`
      : "";

  return (
    <div className="app-container">
      <div className="chat-window">
        <div className="chat-header">
          <div>
            <h2>Alive Chat</h2>
            <div className="room-tag">Room: {roomId}</div>
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

        <form
          className="input-bar"
          onSubmit={sendMessage}
        >
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

function MessageBubble({ message, isMe, reactions, onOpenReactions }) {
  // grupiraj reakcije po emoji
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
              {emoji} {count > 1 && <span className="reaction-count">{count}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
