import { useState } from "react";
import { useVoiceAgent } from "@cloudflare/voice/react";

export default function App() {
  const {
    status,
    transcript,
    interimTranscript,
    metrics,
    isMuted,
    startCall,
    endCall,
    toggleMute,
  } = useVoiceAgent({ agent: "SpaAgent" });

  const [recap, setRecap] = useState<string | null>(null);

  const live = status !== "idle";
  const statusText =
    { 
      idle: "Ready to help", 
      listening: "I'm listening…", 
      thinking: "Thinking…", 
      speaking: "Lotus is speaking" 
    }[status] ?? status;

  async function loadRecap() {
    setRecap("Loading…");
    try {
      const rows = await (await fetch("/admin/log")).json() as any[];
      setRecap(
        rows.length
          ? rows
              .map(
                (r: any) =>
                  `${new Date(r.ts).toLocaleTimeString()}  [${r.kind}]  ${r.payload}`
              )
              .join("\n")
          : "No saved events yet."
      );
    } catch (e) {
      setRecap("Could not load log: " + e);
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <div className="eyebrow">Lotus Day Spa</div>
        <h1>
          Voice <em>Receptionist</em>
        </h1>

        <div className="orb-container">
          <div className={`orb ${status} ${live ? "live" : ""}`} />
        </div>
        
        <div className="status">{statusText}</div>

        <div className="controls">
          <button className={live ? "end" : ""} onClick={live ? endCall : startCall}>
            {live ? "End Call" : "Start Call"}
          </button>
          {live && (
            <button className="secondary" onClick={toggleMute}>
              {isMuted ? "Unmute" : "Mute"}
            </button>
          )}
        </div>

        {interimTranscript && (
          <div className="interim-text">
            "{interimTranscript}"
          </div>
        )}

        <div className="transcript-area">
          {transcript.map((m, i) => (
            <div className={`msg ${m.role}`} key={i}>
              <span className="role-label">{m.role === "user" ? "You" : "Lotus"}</span>
              {m.text}
            </div>
          ))}
          {transcript.length === 0 && !live && (
            <div style={{ textAlign: 'center', opacity: 0.4, fontSize: '0.85rem', marginTop: '2rem' }}>
              Your conversation will appear here
            </div>
          )}
        </div>

        {metrics && (
          <div className="metrics-footer">
            <span>LLM: {metrics.llm_ms}ms</span>
            <span>TTS: {metrics.first_audio_ms}ms</span>
          </div>
        )}

        <div className="twilio-info">
          <h4><span>📞</span> Telephony Active</h4>
          <p style={{ opacity: 0.7 }}>
            Twilio calls to your US number are routed to this agent automatically.
          </p>
        </div>

        {!live && transcript.length > 0 && (
          <div className="recap-area">
            <button className="secondary" onClick={loadRecap}>
              View Call Log
            </button>
            {recap && <pre>{recap}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}