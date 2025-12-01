import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import LoveOverlay from "./LoveOverlay";
import ExplosionOverlay from "./ExplosionOverlay";

const CONVERSATION_ID = "test-convo"; // jedna soba za tvoju betu

function App() {
  const [messages, setMessages] = useState([]);
  const [activeEffect, setActiveEffect] = useState(null);
  const [showExplosion, setShowExplosion] = useState(false);

  const [text, setText] = useState("");
  const [mood, setMood] = useState("normal");
  const [userId, setUserId] = useState("");

  // 1) pitamo za ime usera
  useEffect(() => {
    const name = prompt("Upiši svoje ime / nadimak:");
    setUserId(name || "anon");
  }, []);

  // 2) učitavanje poruka + realtime listener
  useEffect(() => {
    async function loadMessages() {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", CONVERSATION_ID)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("loadMessages error", error);
      } else {
        setMessages(data || []);
      }
    }

    loadMessages();

    const channel = supabase
      .channel("messages-change")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 3) realtime za EFFECTS (love animacija)
  useEffect(() => {
    const channel = supabase
      .channel("effects-change")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "effects" },
        (payload) => {
          setActiveEffect(payload.new);
          setTimeout(() => setActiveEffect(null), 3000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 4) ljuta poruka -> eksplozija kad uđeš u chat
  useEffect(() => {
    if (!userId || messages.length === 0) return;

    const angryFromOthers = messages.filter(
      (m) => m.mood === "angry" && m.sender_id !== userId
    );

    if (angryFromOthers.length === 0) return;

    const latest = angryFromOthers[angryFromOthers.length - 1];

    const key = `lastExploded_${CONVERSATION_ID}_${userId}`;
    const lastExplodedId = localStorage.getItem(key);

    if (lastExplodedId === String(latest.id)) return;

    // nova ljuta poruka -> eksplozija
    setShowExplosion(true);
    localStorage.setItem(key, latest.id);
    setTimeout(() => setShowExplosion(false), 2000);
  }, [userId, messages]);

  // helper: detekcija "volim te"
  function getMessageTypeFromText(t) {
    const n = t.toLowerCase().trim();
    if (n === "volim te" || n === "volim te ❤️") return "love";
    return "normal";
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!text.trim() || !userId) return;

    const type = getMessageTypeFromText(text);

    const { error } = await supabase.from("messages").insert({
      conversation_id: CONVERSATION_ID,
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

    // ako je love poruka -> provjera love_pair
    if (type === "love") {
      const { data: lastMessages } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", CONVERSATION_ID)
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
            conversation_id: CONVERSATION_ID,
            type: "love_pair",
            payload: {},
          });
        }
      }
    }
  }

  return (
    <div className="app-container">
      <div className="chat-window">
        <div className="chat-header">
          <h2>Alive Chat</h2>
          <div className="user-tag">👤 {userId}</div>
        </div>

        <div className="messages-area">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isMe={m.sender_id === userId}
            />
          ))}
        </div>

        <form className="input-bar" onSubmit={sendMessage}>
          <select value={mood} onChange={(e) => setMood(e.target.value)}>
            <option value="normal">🙂</option>
            <option value="soft">💕</option>
            <option value="angry">😡</option>
          </select>

          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Napiši poruku..."
          />
          <button type="submit">➤</button>
        </form>
      </div>

      {activeEffect?.type === "love_pair" && <LoveOverlay />}
      {showExplosion && <ExplosionOverlay />}
    </div>
  );
}

function MessageBubble({ message, isMe }) {
  return (
    <div className={`bubble ${isMe ? "me" : "them"} ${message.mood}`}>
      {!isMe && <div className="sender">{message.sender_id}</div>}
      <div>{message.text}</div>
    </div>
  );
}

export default App;
