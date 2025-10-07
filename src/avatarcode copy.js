import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

/**
 * Realtime Voice Chat with Avatar (frontend-only)
 * - STT: Web Speech API (SpeechRecognition)
 * - TTS: Web Speech API (speechSynthesis)
 * - 3D Avatar: three.js via @react-three/fiber
 * - Start/End buttons to control the whole session
 * - Simulated backend response (streams words)
 *
 * Notes:
 * - Chrome/Edge recommended for SpeechRecognition support.
 * - If SpeechRecognition is unavailable, the app shows a notice and disables STT.
 * - Avatar mouth opens on TTS word boundaries; blinks periodically.
 */

/****************************** Utils ******************************/
const hasSpeechSynthesis = typeof window !== "undefined" && "speechSynthesis" in window;
const SR = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : undefined;

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

/****************************** Avatar ******************************/
function Avatar({ mouthOpen, speaking }) {
  // Simple head with eyes and a mouth bar that scales by mouthOpen
  // mouthOpen: 0..1
  const headRef = useRef();
  const leftEyeRef = useRef();
  const rightEyeRef = useRef();
  const mouthRef = useRef();

  // Blink state (scale eyes to 0 briefly)
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let mounted = true;
    function loop() {
      if (!mounted) return;
      // Random blink every 3-6 seconds, duration ~120ms
      const timeout = 3000 + Math.random() * 3000;
      const t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 120);
        loop();
      }, timeout);
      return () => clearTimeout(t);
    }
    const cleanup = loop();
    return () => {
      mounted = false;
      if (cleanup) cleanup();
    };
  }, []);

  useFrame(() => {
    if (mouthRef.current) {
      const target = speaking ? 0.15 + mouthOpen * 0.35 : 0.02; // min open when not speaking
      // Smoothly lerp current scale to target
      const cur = mouthRef.current.scale.y;
      mouthRef.current.scale.y = cur + (target - cur) * 0.25;
    }
    // Gentle head bob when speaking
    if (headRef.current) {
      const t = performance.now() / 1000;
      const amp = speaking ? 0.03 : 0.005;
      headRef.current.position.y = Math.sin(t * 3) * amp;
    }
    // Blink by scaling eyes on Y
    if (leftEyeRef.current && rightEyeRef.current) {
      const s = blink ? 0.01 : 1.0;
      leftEyeRef.current.scale.y = s;
      rightEyeRef.current.scale.y = s;
    }
  });

  return (
    <group>
      {/* Head */}
      <mesh ref={headRef} position={[0, 1.1, 0]} castShadow>
        <sphereGeometry args={[0.8, 32, 32]} />
        <meshStandardMaterial color="#f0d9b5" />
      </mesh>

      {/* Eyes */}
      <mesh ref={leftEyeRef} position={[-0.3, 1.3, 0.7]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh ref={rightEyeRef} position={[0.3, 1.3, 0.7]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>

      {/* Mouth (a thin box scaled on Y) */}
      <mesh ref={mouthRef} position={[0, 0.8, 0.77]}>
        <boxGeometry args={[0.4, 0.08, 0.05]} />
        <meshStandardMaterial color="#a33" />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.7, 0.9, 1.2, 24]} />
        <meshStandardMaterial color="#5b8def" />
      </mesh>
    </group>
  );
}

/****************************** Hooks: TTS ******************************/
function useTTS({ onBoundary }) {
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef(null);
  const queueRef = useRef([]);
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    if (!hasSpeechSynthesis) return;
    function loadVoices() {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
    }
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const speak = (text) => {
    if (!hasSpeechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    // Optional: pick a default voice if you want
    // u.voice = voices.find(v => /English|en-US/i.test(v.name)) || null;
    u.rate = 1.0;
    u.pitch = 1.0;

    u.onstart = () => setSpeaking(true);
    u.onend = () => {
      setSpeaking(false);
      utteranceRef.current = null;
      // speak next in queue
      const next = queueRef.current.shift();
      if (next) speak(next);
    };
    u.onboundary = (ev) => {
      // word boundary events (Chrome) — approximate mouth opens
      if (onBoundary) onBoundary(ev);
    };

    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  };

  const enqueue = (text) => {
    if (!hasSpeechSynthesis || !text) return;
    if (utteranceRef.current || speaking) {
      queueRef.current.push(text);
    } else {
      speak(text);
    }
  };

  const cancel = () => {
    if (!hasSpeechSynthesis) return;
    queueRef.current = [];
    window.speechSynthesis.cancel();
    setSpeaking(false);
    utteranceRef.current = null;
  };

  return { speak, enqueue, cancel, speaking, voices };
}

/****************************** Hooks: STT ******************************/
function useSTT({ enabled, onFinal, onInterim }) {
  const [supported, setSupported] = useState(!!SR);
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    setSupported(!!SR);
  }, []);

  useEffect(() => {
    if (!supported) return;
    if (!enabled) {
      // stop if disabling
      try { recRef.current && recRef.current.stop(); } catch {}
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

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
    try { rec.start(); } catch {}

    return () => {
      try { rec.stop(); } catch {}
      recRef.current = null;
    };
  }, [supported, enabled]);

  const stop = () => {
    try { recRef.current && recRef.current.stop(); } catch {}
  };

  return { supported, listening, stop };
}

/****************************** Simulated RAG ******************************/
function useSimulatedRag({ onToken, onDone }) {
  // Given a prompt, stream back a fake response word-by-word
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
    }, 60);
  };
  return { respond };
}

/****************************** Main UI ******************************/
export default function VoiceAvatarApp() {
  const [running, setRunning] = useState(false);
  const [sttEnabled, setSttEnabled] = useState(false);
  const [interim, setInterim] = useState("");
  const [inputFinal, setInputFinal] = useState("");
  const [chat, setChat] = useState([]); // {role: 'user'|'assistant', text}

  const [mouthOpen, setMouthOpen] = useState(0);

  // TTS
  const { enqueue, cancel, speaking } = useTTS({
    onBoundary: () => {
      // simple mouth pulse on each boundary
      setMouthOpen(0.9);
      // decay shortly after
      setTimeout(() => setMouthOpen(0.2), 60);
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
      // Kick off simulated RAG streaming
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
      // speak final (or chunk as it streams — here we enqueue at end for clarity)
      enqueue(finalText);
    },
  });

  const streamResponse = (userText) => {
    setAssistantBuffer("");
    respond(userText);
  };

  // Start/End lifecycle
  const startAll = async () => {
    // user gesture: prime audio permissions by requesting mic
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
    // enable STT
    setSttEnabled(true);
    setRunning(true);
  };

  const endAll = () => {
    setSttEnabled(false);
    stopSTT();
    cancel();
    setRunning(false);
  };

  // Mouth idle decay when not getting boundaries
  useEffect(() => {
    const id = setInterval(() => {
      setMouthOpen((m) => Math.max(0, m * 0.8 - 0.01));
    }, 50);
    return () => clearInterval(id);
  }, []);

  // UI helpers
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
            className={classNames(
              "px-4 py-2 rounded-xl",
              running ? "bg-slate-700 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500"
            )}
          >Start</button>
          <button
            onClick={endAll}
            disabled={!running}
            className={classNames(
              "px-4 py-2 rounded-xl",
              !running ? "bg-slate-700 cursor-not-allowed" : "bg-rose-600 hover:bg-rose-500"
            )}
          >End</button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 flex-1">
        {/* Avatar + Canvas */}
        <section className="rounded-2xl border border-slate-800 overflow-hidden">
          <div className="h-[420px] bg-slate-900">
            <Canvas camera={{ position: [0, 1.3, 4], fov: 55 }} shadows>
              <ambientLight intensity={0.6} />
              <directionalLight position={[3, 5, 3]} intensity={1} castShadow />
              <Avatar mouthOpen={mouthOpen} speaking={speaking} />
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
                <planeGeometry args={[20, 20]} />
                <meshStandardMaterial color="#1f2937" />
              </mesh>
              <OrbitControls enablePan={false} minDistance={3} maxDistance={6} />
            </Canvas>
          </div>
          <div className="p-3 text-sm bg-slate-900 border-t border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-slate-400">Status:</span> {status}
            </div>
            <div className="text-slate-400">
              STT: {sttEnabled ? (listening ? "on" : "off") : "off"} ·
              &nbsp;TTS: {hasSpeechSynthesis ? "on" : "unavailable"}
            </div>
          </div>
        </section>

        {/* Chat & Controls */}
        <section className="rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 bg-slate-900">
            <p className="text-sm text-slate-300">
              Press <strong>Start</strong>, speak to the mic. Your speech appears below.
              When you pause, it sends to a simulated backend and streams a response,
              which the avatar will speak aloud.
            </p>
            {!sttSupported && (
              <p className="mt-2 text-amber-400 text-sm">
                Your browser doesn’t support SpeechRecognition. Try Chrome/Edge, or add a fallback.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {chat.map((m, i) => (
              <div key={i} className={classNames("max-w-[90%] px-3 py-2 rounded-xl", m.role === "user" ? "bg-sky-700/40 self-end ml-auto" : "bg-slate-800/70")}
                   style={{ whiteSpace: 'pre-wrap' }}>
                <div className="text-xs opacity-70 mb-1">{m.role === "user" ? "You" : "Assistant"}</div>
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

          <div className="border-t border-slate-800 p-4 bg-slate-900">
            <div className="text-sm text-slate-300">
              <div className="mb-1">
                <span className="text-slate-400">Interim:</span> {interim || <em className="text-slate-600">(waiting…)</em>}
              </div>
              <div>
                <span className="text-slate-400">Last final:</span> {inputFinal || <em className="text-slate-600">(none)</em>}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="p-4 text-center text-xs text-slate-500 border-t border-slate-800">
        Frontend-only demo · Web Speech API (STT/TTS) + three.js avatar · No backend required
      </footer>
    </div>
  );
}
