import { useState, useRef } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface Appt {
  id: number;
  name: string;
  service: string;
  day: string;
  time: string;
  confirmationId: string;
}

// The agent is grounded in this same config server-side (src/agent/tenant.ts).
// These are editable defaults; edits persist in localStorage and ride to the
// worker as participant metadata on the next call (see startCall + KBInput).
type KB = {
  name: string;
  address: string;
  phone: string;
  services: string;
  hours: string;
};

const DEFAULT_KB: KB = {
  name: "Lotus Day Spa",
  address: "1847 Fillmore Street, San Francisco, CA 94115",
  phone: "(415) 555-0142",
  services:
    "Swedish Massage ($120, 60 min) — gentle full-body relaxation, good for stress, sleep, and first-timers. " +
    "Deep Tissue ($140, 90 min) — firm pressure for chronic tension, knots, back/neck pain, desk workers, athletes. " +
    "Facial ($150, 60 min) — customized skin treatment for dull/dehydrated skin or a pre-event glow.",
  hours: "Mon-Wed: 10am-7pm, Thu-Fri: 10am-8pm, Sat: 9am-6pm, Sun: 11am-4pm",
};

const KB_STORAGE_KEY = "lotus-kb";

function loadKB(): KB {
  try {
    const saved = localStorage.getItem(KB_STORAGE_KEY);
    if (saved) return { ...DEFAULT_KB, ...JSON.parse(saved) };
  } catch {
    /* ignore corrupt storage, use defaults */
  }
  return DEFAULT_KB;
}

export default function App() {
  const [isLive, setIsLive] = useState(false);
  const [model, setModel] = useState<"gemini" | "deepseek">("gemini");
  const [status, setStatus] = useState("Ready to Start");
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [appointments, setAppointments] = useState<Appt[]>([]);
  const [kb, setKb] = useState<KB>(loadKB);
  const [saved, setSaved] = useState(false);
  const roomRef = useRef<Room | null>(null);

  const editKb = (field: keyof KB) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setKb((prev) => ({ ...prev, [field]: e.target.value }));
    setSaved(false);
  };

  const saveKb = () => {
    localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(kb));
    setSaved(true);
  };

  const startCall = async () => {
    try {
      // Ship the current KB to the worker as participant metadata. It grounds the
      // agent on this call; editing mid-call has no effect (read once at start).
      const kbParam = encodeURIComponent(JSON.stringify(kb));
      const { token, url } = await fetch(
        `/api/token?model=${model}&kb=${kbParam}`,
      ).then((r) => r.json());
      const room = new Room();
      roomRef.current = room;

      // Agent audio: subscribe + attach so it plays. LiveKit handles the
      // jitter buffer and barge-in natively — no manual scheduling.
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          document.body.appendChild(el);
        }
      });

      // Live transcript: STT (user) + agent speech arrive as transcription
      // segments. Upsert by segment id so interim text updates in place, then
      // finalizes — gives the live "typing" feel without duplicate lines.
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const role: Msg["role"] = participant?.isLocal ? "user" : "assistant";
        setTranscript((prev) => {
          const next = [...prev];
          for (const seg of segments) {
            const idx = next.findIndex((m) => m.id === seg.id);
            const msg: Msg = { id: seg.id, role, text: seg.text };
            if (idx >= 0) next[idx] = msg;
            else next.push(msg);
          }
          return next;
        });
      });

      // Confirmed bookings pushed by the worker on the 'booking' topic.
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic && topic !== "booking") return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === "booking" && msg.appt) {
            setAppointments((prev) => [...prev, msg.appt as Appt]);
          }
        } catch (e) {
          console.error("bad data message:", e);
        }
      });

      room.on(RoomEvent.Disconnected, () => endCall());
      // Agent-initiated end: worker calls ctx.room.disconnect() which makes the
      // agent participant leave. That fires ParticipantDisconnected here, not
      // Disconnected (which only fires when the local participant disconnects).
      room.on(RoomEvent.ParticipantDisconnected, () => endCall());

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setIsLive(true);
      setStatus("Connected");
    } catch (e) {
      console.error("Failed to start call:", e);
      alert("Please allow microphone access to start the call.");
    }
  };

  const endCall = async () => {
    const room = roomRef.current;
    if (!room) return;
    roomRef.current = null;
    setIsLive(false);
    setStatus("Ready to Start");
    await room.disconnect();
  };

  return (
    <div className="app-container">
      {/* Left Sidebar: Knowledge Base — editable, grounds the agent's answers */}
      <aside className="kb-sidebar">
        <h2>Knowledge Base</h2>
        <div className="form-group">
          <label>Spa Name</label>
          <input value={kb.name} onChange={editKb("name")} disabled={isLive} />
        </div>
        <div className="form-group">
          <label>Address</label>
          <input value={kb.address} onChange={editKb("address")} disabled={isLive} />
        </div>
        <div className="form-group">
          <label>Phone</label>
          <input value={kb.phone} onChange={editKb("phone")} disabled={isLive} />
        </div>
        <div className="form-group">
          <label>Services &amp; Pricing</label>
          <textarea rows={6} value={kb.services} onChange={editKb("services")} disabled={isLive} />
        </div>
        <div className="form-group">
          <label>Availability / Hours</label>
          <textarea rows={3} value={kb.hours} onChange={editKb("hours")} disabled={isLive} />
        </div>
        <button className="kb-save-btn" onClick={saveKb} disabled={isLive}>
          {saved ? "✓ Saved" : "Save"}
        </button>
        <p className="kb-hint">Changes apply on your next call.</p>
      </aside>

      {/* Main Content: Agent Interaction */}
      <main className="main-content">
        <header className="agent-header">
          <h1>Lotus — Voice Demo</h1>
          <div className="status-indicator">
            <div className={`dot ${isLive ? "live" : ""}`} />
            {status}
          </div>
        </header>

        <div className="model-toggle">
          <span className="model-toggle-label">Model</span>
          {(["gemini", "deepseek"] as const).map((m) => (
            <button
              key={m}
              className={`model-option ${model === m ? "active" : ""}`}
              onClick={() => setModel(m)}
              disabled={isLive}
            >
              {m === "gemini" ? "Gemini 3.1" : "DeepSeek V4"}
            </button>
          ))}
        </div>

        <div className="call-controls">
          <button
            className={`start-btn ${isLive ? "end" : ""}`}
            onClick={isLive ? endCall : startCall}
          >
            {isLive ? (
              <>
                <span>🛑</span> End Call
              </>
            ) : (
              <>
                <span>📞</span> Start Browser Call
              </>
            )}
          </button>
        </div>

        <div className="transcript-container">
          {transcript.length === 0 ? (
            <div
              style={{ textAlign: "center", color: "#9ca3af", marginTop: "4rem" }}
            >
              Your conversation transcript will appear here in real-time.
            </div>
          ) : (
            transcript.map((m) => (
              <div className={`message ${m.role}`} key={m.id}>
                <span className="msg-label">
                  {m.role === "user" ? "You" : "Lotus"}
                </span>
                {m.text}
              </div>
            ))
          )}
        </div>
      </main>

      {/* Right Sidebar: live bookings rail (fed by the worker's data messages) */}
      <aside className="activity-sidebar">
        <h2>Recent Bookings</h2>
        {appointments.length === 0 ? (
          <p style={{ color: "#9ca3af", fontSize: "0.9rem" }}>
            No appointments booked yet.
          </p>
        ) : (
          [...appointments].reverse().map((appt) => (
            <div key={appt.confirmationId} className="appointment-card">
              <strong>{appt.name}</strong>
              <div className="service">{appt.service}</div>
              <div className="time">
                {appt.day} @ {appt.time}
              </div>
              <div className="conf-id">{appt.confirmationId}</div>
            </div>
          ))
        )}
      </aside>
    </div>
  );
}
