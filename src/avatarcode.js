// src/VoiceAvatarApp.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";

/**
 * Realtime Voice Chat (Frontend-only)
 * - STT: Web Speech API (SpeechRecognition)
 * - TTS: Web Speech API (speechSynthesis) with pre-warm + sentence queue
 * - Avatar: three.js (react-three-fiber) w/ lighting & shadows
 * - Start / End buttons manage the whole session
 * - Simulated streaming response to test without backend
 */

const hasSpeechSynthesis =
  typeof window !== "undefined" && "speechSynthesis" in window;
const SR =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

/* ------------------------------ Avatar ------------------------------ */
function Avatar({ mouthOpen, speaking }) {
  const headRef = useRef();
  const mouthRef = useRef();
  const leftEyeRef = useRef();
  const rightEyeRef = useRef();
  const leftBrowRef = useRef();
  const rightBrowRef = useRef();

  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let mounted = true;
    let tid;
    const loop = () => {
      if (!mounted) return;
      const timeout = 2800 + Math.random() * 3200;
      tid = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 120);
        loop();
      }, timeout);
    };
    loop();
    return () => {
      mounted = false;
      clearTimeout(tid);
    };
  }, []);

  useFrame(() => {
    // Subtle head bob/tilt
    if (headRef.current) {
      const t = performance.now() / 1000;
      headRef.current.position.y = Math.sin(t * 3) * (speaking ? 0.03 : 0.01);
      headRef.current.rotation.z = Math.sin(t * 1.5) * (speaking ? 0.02 : 0.005);
    }
    // Mouth openness lerp
    if (mouthRef.current) {
      const cur = mouthRef.current.scale.y;
      const target = speaking ? 0.2 + mouthOpen * 0.6 : 0.05;
      mouthRef.current.scale.y = cur + (target - cur) * 0.25;
    }
    // Blink
    if (leftEyeRef.current && rightEyeRef.current) {
      const s = blink ? 0.02 : 1.0;
      leftEyeRef.current.scale.y = s;
      rightEyeRef.current.scale.y = s;
    }
    // Brows micro-motion
    if (leftBrowRef.current && rightBrowRef.current) {
      const t = performance.now() / 1000;
      const off = Math.sin(t * 2) * 0.02 + (speaking ? 0.03 : 0);
      leftBrowRef.current.position.y = 1.55 + off;
      rightBrowRef.current.position.y = 1.55 + off;
    }
  });

  const skin = "#f1d6b8";
  const shirt = "#4067f9";
  const mouthCol = "#c0392b";

  return (
    <group>
      {/* Head */}
      <mesh ref={headRef} position={[0, 1.2, 0]} castShadow>
        <sphereGeometry args={[0.85, 48, 48]} />
        <meshStandardMaterial color={skin} roughness={0.6} metalness={0.05} />
      </mesh>

      {/* Eyes */}
      <mesh ref={leftEyeRef} position={[-0.28, 1.38, 0.72]} castShadow>
        <sphereGeometry args={[0.085, 24, 24]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh ref={rightEyeRef} position={[0.28, 1.38, 0.72]} castShadow>
        <sphereGeometry args={[0.085, 24, 24]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      {/* Brows */}
      <mesh
        ref={leftBrowRef}
        position={[-0.28, 1.55, 0.68]}
        rotation={[0, 0, 0.08]}
      >
        <boxGeometry args={[0.22, 0.04, 0.06]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh
        ref={rightBrowRef}
        position={[0.28, 1.55, 0.68]}
        rotation={[0, 0, -0.08]}
      >
        <boxGeometry args={[0.22, 0.04, 0.06]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      {/* Mouth (scaled on Y) */}
      <mesh ref={mouthRef} position={[0, 1.0, 0.79]}>
        <boxGeometry args={[0.46, 0.1, 0.06]} />
        <meshStandardMaterial
          color={mouthCol}
          roughness={0.4}
          metalness={0.05}
        />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.75, 0.92, 1.25, 28]} />
        <meshStandardMaterial color={shirt} roughness={0.8} />
      </mesh>
    </group>
  );
}

/* ------------------------------- TTS ------------------------------- */
function useTTS({ onBoundary }) {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const utteranceRef = useRef(null);
  const queueRef = useRef([]);
  const boundarySupportedRef = useRef(false);
  const timerFallbackRef = useRef(null);

  // Load voices
  useEffect(() => {
    if (!hasSpeechSynthesis) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // Pre-warm after user gesture to avoid first-utterance silence
  const prewarm = () => {
    if (!hasSpeechSynthesis) return;
    const u = new SpeechSynthesisUtterance(".");
    u.volume = 0.001;
    try {
      window.speechSynthesis.speak(u);
    } catch {}
  };

  const _speak = (text) => {
    if (!hasSpeechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    // Prefer an English voice if available
    const v =
      voices.find((v) => /en[-_]?US|English/i.test(v.name)) || voices[0];
    if (v) u.voice = v;
    u.volume = 1.0;
    u.rate = 1.0;
    u.pitch = 1.0;

    boundarySupportedRef.current = false;

    u.onstart = () => {
      setSpeaking(true);
      // Fallback: if boundary events don't fire, pulse the mouth on a timer
      timerFallbackRef.current = setInterval(() => {
        if (!boundarySupportedRef.current && onBoundary) onBoundary({});
      }, 140);
    };

    u.onend = () => {
      clearInterval(timerFallbackRef.current);
      setSpeaking(false);
      utteranceRef.current = null;
      const next = queueRef.current.shift();
      if (next) _speak(next);
    };

    u.onboundary = (ev) => {
      boundarySupportedRef.current = true;
      if (onBoundary) onBoundary(ev);
    };

    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  };

  const speak = (text) => _speak(text);

  // Enqueue long text by sentence for quicker start + smoother events
  const enqueueChunked = (text) => {
    if (!text) return;
    const parts = text.match(/[^.!?\n]+[.!?]?/g) || [text];
    if (utteranceRef.current || speaking) queueRef.current.push(...parts);
    else _speak(parts.shift());
    queueRef.current.push(...parts);
  };

  const cancel = () => {
    if (!hasSpeechSynthesis) return;
    queueRef.current = [];
    window.speechSynthesis.cancel();
    setSpeaking(false);
    utteranceRef.current = null;
    clearInterval(timerFallbackRef.current);
  };

  return { speak, enqueueChunked, cancel, speaking, voices, prewarm };
}

/* ------------------------------- STT ------------------------------- */
function useSTT({ enabled, onFinal, onInterim }) {
  const [supported, setSupported] = useState(!!SR);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  useEffect(() => setSupported(!!SR), []);

  useEffect(() => {
    if (!supported) return;
    if (!enabled) {
      try {
        recRef.current && recRef.current.stop();
      } catch {}
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      console.warn("STT error", e);
      setListening(false);
    };
    rec.onresult = (e) => {
      let interim = "";
      let finals = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(r[0].transcript);
        else interim += r[0].transcript;
      }
      if (interim && onInterim) onInterim(interim);
      if (finals.length && onFinal) onFinal(finals.join(" "));
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {}
    return () => {
      try {
        rec.stop();
      } catch {}
      recRef.current = null;
    };
  }, [supported, enabled]);

  const stop = () => {
    try {
      recRef.current && recRef.current.stop();
    } catch {}
  };

  return { supported, listening, stop };
}

/* -------------------------- Simulated RAG -------------------------- */
function useSimulatedRag({ onToken, onDone }) {
  const respond = (prompt) => {
    const base = `You said: "${prompt}". Here's a simulated helpful response streaming live. This would normally come from your RAG backend via SSE.`;
    const words = base.split(" ");
    let i = 0;
    const id = setInterval(() => {
      if (i < words.length) {
        onToken(words[i] + (i < words.length - 1 ? " " : ""));
        i++;
      } else {
        clearInterval(id);
        onDone && onDone();
      }
    }, 45);
  };
  return { respond };
}

/* ------------------------------- UI ------------------------------- */
export default function VoiceAvatarApp() {
  const [running, setRunning] = useState(false);
  const [sttEnabled, setSttEnabled] = useState(false);
  const [interim, setInterim] = useState("");
  const [inputFinal, setInputFinal] = useState("");
  const [chat, setChat] = useState([]); // {role: 'user'|'assistant', text}
  const [mouthOpen, setMouthOpen] = useState(0);

  // TTS
  const { enqueueChunked, cancel, speaking, prewarm } = useTTS({
    onBoundary: () => {
      // Pulse mouth on each boundary (or timer fallback)
      setMouthOpen(0.95);
      setTimeout(() => setMouthOpen(0.2), 70);
    },
  });

  // STT
  const { supported: sttSupported, listening, stop: stopSTT } = useSTT({
    enabled: sttEnabled,
    onInterim: setInterim,
    onFinal: (text) => {
      setInterim("");
      setInputFinal(text);
      setChat((c) => [...c, { role: "user", text }]);
      streamResponse(text);
    },
  });

  // Simulated streaming response
  const [assistantBuffer, setAssistantBuffer] = useState("");
  const { respond } = useSimulatedRag({
    onToken: (tok) => setAssistantBuffer((s) => s + tok),
    onDone: () => {
      const finalText = assistantBuffer;
      setChat((c) => [...c, { role: "assistant", text: finalText }]);
      setAssistantBuffer("");
      enqueueChunked(finalText); // speak it
    },
  });

  const streamResponse = (userText) => {
    setAssistantBuffer("");
    respond(userText);
  };

  // Start / End
  const startAll = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      console.warn("Mic permission error:", e);
    }
    prewarm(); // user gesture just happened, pre-warm TTS
    setSttEnabled(true);
    setRunning(true);
  };

  const endAll = () => {
    setSttEnabled(false);
    stopSTT();
    cancel();
    setRunning(false);
  };

  // Idle mouth decay
  useEffect(() => {
    const id = setInterval(
      () => setMouthOpen((m) => Math.max(0, m * 0.82 - 0.01)),
      50
    );
    return () => clearInterval(id);
  }, []);

  const status = useMemo(() => {
    if (!running) return "Idle";
    if (listening) return interim ? "Listening (interim)…" : "Listening…";
    if (speaking) return "Speaking…";
    return "Ready";
  }, [running, listening, speaking, interim]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Realtime Voice Chat · 3D Avatar</h1>
        <div className="space-x-2">
          <button
            onClick={startAll}
            disabled={running}
            className={cx(
              "px-4 py-2 rounded-xl",
              running ? "bg-slate-700 cursor-not-allowed" : "bg-emerald-600"
            )}
          >
            Start
          </button>
          <button
            onClick={endAll}
            disabled={!running}
            className={cx(
              "px-4 py-2 rounded-xl",
              !running ? "bg-slate-700 cursor-not-allowed" : "bg-rose-600"
            )}
          >
            End
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 flex-1">
        {/* Avatar + Canvas */}
        <section className="rounded-2xl border border-slate-800 overflow-hidden">
          <div className="h-[440px] bg-slate-900">
            <Canvas camera={{ position: [0, 1.4, 4.2], fov: 55 }} shadows>
              <ambientLight intensity={0.5} />
              <directionalLight
                castShadow
                intensity={1.2}
                position={[3, 5, 3]}
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
              />
              <Environment preset="studio" />
              <Avatar mouthOpen={mouthOpen} speaking={speaking} />
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, -0.55, 0]}
                receiveShadow
              >
                <planeGeometry args={[30, 30]} />
                <meshStandardMaterial color="#0f172a" />
              </mesh>
              <ContactShadows
                position={[0, -0.54, 0]}
                opacity={0.5}
                scale={10}
                blur={1.5}
                far={2}
              />
              <OrbitControls enablePan={false} minDistance={3} maxDistance={6} />
            </Canvas>
          </div>
          <div className="p-3 text-sm bg-slate-900 border-t border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-slate-400">Status:</span> {status}
            </div>
            <div className="text-slate-400">
              STT: {sttEnabled ? (listening ? "on" : "off") : "off"} ·&nbsp;TTS:{" "}
              {hasSpeechSynthesis ? "on" : "unavailable"}
            </div>
          </div>
        </section>

        {/* Chat */}
        <section className="rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 bg-slate-900">
            <p className="text-sm text-slate-300">
              Press <strong>Start</strong>, speak to the mic. Your speech appears
              below. When you pause, it streams a simulated response that the
              avatar will speak aloud.
            </p>
            {!SR && (
              <p className="mt-2 text-amber-400 text-sm">
                Your browser doesn’t support SpeechRecognition. Try Chrome/Edge,
                or add a Whisper-in-browser fallback.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {chat.map((m, i) => (
              <div
                key={i}
                className={cx(
                  "max-w-[90%] px-3 py-2 rounded-xl",
                  m.role === "user"
                    ? "bg-sky-700/40 self-end ml-auto"
                    : "bg-slate-800/70"
                )}
                style={{ whiteSpace: "pre-wrap" }}
              >
                <div className="text-xs opacity-70 mb-1">
                  {m.role === "user" ? "You" : "Assistant"}
                </div>
                {m.text}
              </div>
            ))}
            {!!assistantBuffer && (
              <div className="max-w-[90%] px-3 py-2 rounded-xl bg-slate-800/70">
                <div className="text-xs opacity-70 mb-1">Assistant</div>
                <span className="opacity-80">{assistantBuffer}</span>
                <span className="animate-pulse">▌</span>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 p-4 bg-slate-900 text-sm text-slate-300">
            <div className="mb-1">
              <span className="text-slate-400">Interim:</span>{" "}
              {interim || <em className="text-slate-600">(waiting…)</em>}
            </div>
            <div>
              <span className="text-slate-400">Last final:</span>{" "}
              {inputFinal || <em className="text-slate-600">(none)</em>}
            </div>
          </div>
        </section>
      </main>

      <footer className="p-4 text-center text-xs text-slate-500 border-t border-slate-800">
        Frontend-only demo · Web Speech API (STT/TTS) + three.js avatar
      </footer>
    </div>
  );
}
