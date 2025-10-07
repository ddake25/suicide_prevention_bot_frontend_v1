// src/VRMAvatarApp.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { VRM, VRMUtils, VRMExpressionPresetName } from "three-vrm";

// ---- feature detection ----
const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;
const SR =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

// ---- helpers ----
function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

// Map vowels → VRM expression preset
function pickExpressionFromWord(word) {
  if (!word) return VRMExpressionPresetName.Aa;
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  // rough vowel priority
  if (/[oɔɒ]/.test(w) || /o/.test(w)) return VRMExpressionPresetName.O;
  if (/[eɛ]/.test(w) || /e/.test(w)) return VRMExpressionPresetName.E;
  if (/[iɪy]/.test(w) || /i/.test(w)) return VRMExpressionPresetName.I;
  if (/[uʊw]/.test(w) || /u/.test(w)) return VRMExpressionPresetName.U;
  // default open/jaw for 'a' or anything else
  return VRMExpressionPresetName.Aa;
}

// ---------------- TTS hook (browser-native) ----------------
function useTTS({ onWord = () => {} } = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const uRef = useRef(null);
  const resumeTickerRef = useRef(null);

  // load voices reliably
  useEffect(() => {
    if (!hasTTS) return;
    const ensure = () =>
      setVoices(window.speechSynthesis.getVoices() || []);
    ensure();
    window.speechSynthesis.onvoiceschanged = ensure;
  }, []);

  const prewarm = useCallback(() => {
    if (!hasTTS) return;
    try {
      window.speechSynthesis.resume();
      const u = new SpeechSynthesisUtterance(".");
      u.volume = 0.001;
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  const startResumeTicker = () => {
    if (!hasTTS || resumeTickerRef.current) return;
    resumeTickerRef.current = setInterval(() => {
      try { window.speechSynthesis.resume(); } catch {}
    }, 800);
  };
  const stopResumeTicker = () => {
    clearInterval(resumeTickerRef.current);
    resumeTickerRef.current = null;
  };

  const speak = useCallback((text) => {
    if (!hasTTS || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    const v =
      voices.find((v) => /en[-_]?US|English/i.test(v.name)) || voices[0];
    if (v) u.voice = v;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;

    u.onstart = () => {
      setSpeaking(true);
      startResumeTicker();
    };
    u.onend = () => {
      stopResumeTicker();
      setSpeaking(false);
      uRef.current = null;
    };
    // word boundary (Chrome/Edge) – we’ll guess a viseme from the word
    u.onboundary = (ev) => {
      if (ev.name === "word" || ev.charLength > 0) {
        const str = text.slice(ev.charIndex, ev.charIndex + ev.charLength);
        onWord(str);
      }
    };

    uRef.current = u;
    try {
      window.speechSynthesis.speak(u);
    } catch {}
  }, [voices, onWord]);

  const cancel = useCallback(() => {
    if (!hasTTS) return;
    try { window.speechSynthesis.cancel(); } catch {}
    stopResumeTicker();
    setSpeaking(false);
    uRef.current = null;
  }, []);

  return { speaking, speak, cancel, prewarm };
}

// ---------------- STT hook (optional) ----------------
function useSTT({ enabled, onFinal, onInterim }) {
  const [supported, setSupported] = useState(!!SR);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  useEffect(() => setSupported(!!SR), []);

  useEffect(() => {
    if (!supported) return;
    if (!enabled) {
      try { recRef.current && recRef.current.stop(); } catch {}
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      if (enabled) setTimeout(() => { try { rec.start(); } catch {} }, 200);
    };
    rec.onerror = () => {
      setListening(false);
      if (enabled) setTimeout(() => { try { rec.start(); } catch {} }, 300);
    };
    rec.onresult = (e) => {
      let interim = "", finals = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(r[0].transcript);
        else interim += r[0].transcript;
      }
      if (interim) onInterim?.(interim);
      if (finals.length) onFinal?.(finals.join(" "));
    };

    recRef.current = rec;
    try { rec.start(); } catch {}
    return () => { try { rec.stop(); } catch {}; recRef.current = null; };
  }, [supported, enabled, onFinal, onInterim]);

  return { supported, listening };
}

// ---------------- VRM Loader ----------------
async function loadVRM(url) {
  const loader = new THREE.FileLoader();
  loader.setResponseType("arraybuffer");
  const buffer = await new Promise((res, rej) => {
    loader.load(url, res, undefined, rej);
  });
  // Convert to VRM
  const vrm = await VRM.from(buffer);
  // optimize
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.removeUnnecessaryJoints(vrm.scene);
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
    if (obj.isMesh) obj.castShadow = obj.receiveShadow = true;
  });
  return vrm;
}

// ---------------- VRM Canvas Model ----------------
function VRMModel({ url, expressionDrive }) {
  const group = useRef();
  const vrmRef = useRef(null);
  const { scene } = useThree();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const vrm = await loadVRM(url);
      if (!mounted) return;
      vrmRef.current = vrm;
      scene.add(vrm.scene);
      // Pose
      vrm.scene.position.set(0, -1.0, 0);
      vrm.scene.rotation.y = Math.PI; // face camera
    })();
    return () => {
      mounted = false;
      if (vrmRef.current) {
        scene.remove(vrmRef.current.scene);
        vrmRef.current.dispose();
        vrmRef.current = null;
      }
    };
  }, [url, scene]);

  // decay expressions every frame; apply the current target expression weight
  useFrame((_, dt) => {
    const vrm = vrmRef.current;
    if (!vrm || !vrm.expressionManager) return;

    // Smoothly decay all presets a little
    const names = Object.values(VRMExpressionPresetName);
    names.forEach((name) => {
      const cur = vrm.expressionManager.getValue(name) || 0;
      const decayed = Math.max(0, cur - dt * 3.2 * 0.1);
      vrm.expressionManager.setValue(name, decayed);
    });

    // Apply driven expression (from TTS word event)
    const { name, weight } = expressionDrive.current;
    if (name && weight > 0) {
      // small smoothing
      const cur = vrm.expressionManager.getValue(name) || 0;
      const target = Math.max(cur, weight);
      vrm.expressionManager.setValue(name, target);
      // also a touch of jaw open with Aa for “energy”
      if (name !== VRMExpressionPresetName.Aa) {
        const jaw = vrm.expressionManager.getValue(VRMExpressionPresetName.Aa) || 0;
        vrm.expressionManager.setValue(
          VRMExpressionPresetName.Aa,
          Math.max(jaw, weight * 0.25)
        );
      }
      // decay the drive value
      expressionDrive.current.weight *= 0.82;
      if (expressionDrive.current.weight < 0.02) {
        expressionDrive.current.name = null;
        expressionDrive.current.weight = 0;
      }
    }
  });

  return <group ref={group} />;
}

// ---------------- Main App ----------------
export default function VRMAvatarApp() {
  const [running, setRunning] = useState(false);
  const [sttOn, setSttOn] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [log, setLog] = useState([]);
  const expressionDrive = useRef({ name: null, weight: 0 });

  const { speaking, speak, cancel, prewarm } = useTTS({
    onWord: (word) => {
      const name = pickExpressionFromWord(word);
      expressionDrive.current.name = name;
      expressionDrive.current.weight = 1.0; // pulse up; VRMModel will decay smoothly
    },
  });

  const { supported: sttSupported, listening } = useSTT({
    enabled: sttOn,
    onInterim: setInterim,
    onFinal: (t) => {
      setInterim("");
      setFinalText(t);
      setLog((L) => [...L, { role: "you", text: t }]);
      // Simulate an answer (replace with your API call/stream)
      const reply =
        `You said: “${t}”. This is a simulated response. ` +
        `With a real RAG backend you would stream tokens here.`;
      setLog((L) => [...L, { role: "bot", text: reply }]);
      speak(reply);
    },
  });

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
    prewarm(); // IMPORTANT: user gesture unlocks TTS
    setRunning(true);
    setSttOn(true); // auto start STT; toggle off if you want manual control
  };

  const endAll = () => {
    setSttOn(false);
    cancel();
    setRunning(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h1 className="text-lg font-semibold">VRM Avatar · Free Browser TTS/STT</h1>
        <div className="space-x-2">
          <button
            onClick={startAll}
            disabled={running}
            className={cx(
              "px-3 py-2 rounded-lg",
              running ? "bg-slate-700 cursor-not-allowed" : "bg-emerald-600"
            )}
          >
            Start
          </button>
          <button
            onClick={endAll}
            disabled={!running}
            className={cx(
              "px-3 py-2 rounded-lg",
              !running ? "bg-slate-700 cursor-not-allowed" : "bg-rose-600"
            )}
          >
            End
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 flex-1">
        {/* Canvas */}
        <section className="rounded-2xl border border-slate-800 overflow-hidden">
          <div className="h-[460px] bg-slate-900">
            <Canvas camera={{ position: [0, 1.45, 3.6], fov: 55 }} shadows>
              <ambientLight intensity={0.55} />
              <directionalLight
                position={[3, 5, 3]}
                intensity={1.2}
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
              />
              <Environment preset="studio" />
              <VRMModel url="/avatar.vrm" expressionDrive={expressionDrive} />
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, -0.6, 0]}
                receiveShadow
              >
                <planeGeometry args={[30, 30]} />
                <meshStandardMaterial color="#0f172a" />
              </mesh>
              <ContactShadows position={[0, -0.59, 0]} opacity={0.45} scale={8} blur={1.8} far={2} />
              <OrbitControls enablePan={false} minDistance={2.8} maxDistance={6} />
            </Canvas>
          </div>
          <div className="p-3 text-sm bg-slate-900 border-t border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-slate-400">TTS:</span> {hasTTS ? "on" : "unavailable"} ·{" "}
              <span className="text-slate-400">STT:</span>{" "}
              {sttOn ? (listening ? "listening" : "idle") : "off"}
            </div>
            <div>{speaking ? "Speaking…" : "Ready"}</div>
          </div>
        </section>

        {/* Chat / Controls */}
        <section className="rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 bg-slate-900">
            <p className="text-sm text-slate-300">
              Put your Ready Player Me <code>avatar.vrm</code> into <code>public/</code>.
              Click <strong>Start</strong> to allow mic + pre-warm TTS. Speak, or type a message below and press “Speak Test”.
            </p>
            {!SR && (
              <p className="mt-2 text-amber-400 text-sm">
                Your browser lacks SpeechRecognition (Chrome/Edge recommended). TTS will still work.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {log.map((m, i) => (
              <div
                key={i}
                className={cx(
                  "max-w-[90%] px-3 py-2 rounded-xl",
                  m.role === "you" ? "bg-sky-700/40 self-end ml-auto" : "bg-slate-800/70"
                )}
                style={{ whiteSpace: "pre-wrap" }}
              >
                <div className="text-xs opacity-70 mb-1">
                  {m.role === "you" ? "You" : "Avatar"}
                </div>
                {m.text}
              </div>
            ))}
          </div>

          <Tester speak={speak} />
        </section>
      </main>

      <footer className="p-3 text-center text-xs text-slate-500 border-t border-slate-800">
        three.js + React-Three-Fiber + three-vrm · Free, browser-only lip-sync (word-boundary based)
      </footer>
    </div>
  );
}

/** Simple test bar to make the avatar talk without STT */
function Tester({ speak }) {
  const [value, setValue] = useState("Hello! This is a free browser-based VRM avatar speaking.");
  return (
    <div className="border-t border-slate-800 p-4 bg-slate-900 flex gap-2">
      <input
        className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-sm outline-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type something for TTS…"
      />
      <button
        onClick={() => speak(value)}
        className="px-3 py-2 rounded-lg bg-indigo-600"
      >
        Speak test
      </button>
    </div>
  );
}
