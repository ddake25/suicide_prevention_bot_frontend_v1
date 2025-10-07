// src/components/avatar/TalkingAvatar.jsx
import React, { useEffect, useRef, useState } from "react";
import { Card, Button, Alert, Spinner, Row, Col, Badge } from "react-bootstrap";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRM, VRMUtils, VRMLoaderPlugin, VRMHumanBoneName,
} from "@pixiv/three-vrm";

// const VRM_URL = "/avatars/si0JK_MIHIRO.vrm";
const VRM_URL = "/avatars/4876888923308523849.vrm";

/* ===================== Mobile/HTTPS helpers ===================== */
const hasSecureContext = () =>
  (typeof window !== "undefined" && window.isSecureContext === true) ||
  (typeof window !== "undefined" && window.location?.hostname === "localhost");

const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

// One-time “unlock” for mobile: request mic + prime TTS (requires user gesture)
let unlockedMedia = false;
async function unlockMobileAudio() {
  if (unlockedMedia) return true;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());

    // Prime TTS on some browsers
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }

    unlockedMedia = true;
    return true;
  } catch (e) {
    console.warn("unlockMobileAudio failed", e);
    return false;
  }
}
/* ================================================================ */

// ---------- VRM Loader ----------
async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("Loaded GLTF does not contain a VRM model.");
  VRMUtils.removeUnnecessaryJoints(vrm.scene);
  vrm.scene.traverse((obj) => (obj.frustumCulled = false));
  vrm.scene.rotation.y = 0; // face forward
  return vrm;
}

// ---------- Helper: make VRM look at the camera ----------
function LookAtTarget({ vrm }) {
  const { camera } = useThree();
  useFrame(() => {
    if (vrm?.lookAt) vrm.lookAt.target = camera;
  });
  return null;
}

// ---------- Scene with VRM ----------
function VRMScene({ vrm, speaking }) {
  const groupRef = useRef(null);
  const tRef = useRef(0);

  const bonesRef = useRef(null);
  const getBones = (vrm) => {
    if (!vrm) return null;
    const h = vrm.humanoid;
    const get = (n) => h?.getNormalizedBoneNode(n) || null;
    return {
      head: get(VRMHumanBoneName.Head),
      neck: get(VRMHumanBoneName.Neck),
      chest: get(VRMHumanBoneName.Chest) || get(VRMHumanBoneName.UpperChest),
      spine: get(VRMHumanBoneName.Spine),
      lUpperArm: get(VRMHumanBoneName.LeftUpperArm),
      rUpperArm: get(VRMHumanBoneName.RightUpperArm),
      lLowerArm: get(VRMHumanBoneName.LeftLowerArm),
      rLowerArm: get(VRMHumanBoneName.RightLowerArm),
      lHand: get(VRMHumanBoneName.LeftHand),
      rHand: get(VRMHumanBoneName.RightHand),
      lShoulder: get(VRMHumanBoneName.LeftShoulder),
      rShoulder: get(VRMHumanBoneName.RightShoulder),
    };
  };

  const blinkRef = useRef({ t: 0, nextBlink: 1.5 + Math.random() * 2.0, phase: 0, v: 0 });
  const gestureRef = useRef({ active: false, side: "right", t: 0, dur: 1.2, next: 2.5 });
  const dirRef = useRef({ l: +1, r: +1, done: false });

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));

  useFrame((_, delta) => {
    if (!vrm) return;
    tRef.current += delta;

    const em = vrm.expressionManager;

    if (!bonesRef.current) bonesRef.current = getBones(vrm);
    const {
      head, neck, chest, spine,
      lShoulder, rShoulder, lUpperArm, rUpperArm, lLowerArm, rLowerArm, lHand, rHand
    } = bonesRef.current || {};

    // one-time upper arm raise direction check
    if (!dirRef.current.done && lUpperArm && rUpperArm && lHand && rHand) {
      const measureRaiseSign = (upper, hand) => {
        const saved = upper.rotation.z;
        upper.rotation.z = saved + 0.18;
        vrm.scene.updateMatrixWorld(true);
        const hy1 = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld).y;
        upper.rotation.z = saved - 0.18;
        vrm.scene.updateMatrixWorld(true);
        const hy2 = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld).y;
        upper.rotation.z = saved;
        return hy1 > hy2 ? +1 : -1;
      };
      dirRef.current.l = measureRaiseSign(lUpperArm, lHand);
      dirRef.current.r = measureRaiseSign(rUpperArm, rHand);
      dirRef.current.done = true;
    }
    const raiseL = dirRef.current.l;
    const raiseR = dirRef.current.r;

    // idle sway
    if (spine) { spine.rotation.x = Math.sin(tRef.current * 1.2) * 0.01; spine.rotation.y = Math.sin(tRef.current * 0.7) * 0.01; }
    if (chest) { chest.rotation.x = Math.sin(tRef.current * 1.0) * 0.015; chest.rotation.y = Math.sin(tRef.current * 0.5) * 0.012; }
    if (neck)  { neck.rotation.x = Math.sin(tRef.current * 0.9) * 0.02;   neck.rotation.y = Math.sin(tRef.current * 0.6 + 0.5) * 0.02; }
    if (head)  { head.rotation.x = Math.sin(tRef.current * 1.1 + 0.3) * 0.018; head.rotation.y = Math.sin(tRef.current * 0.8) * 0.018; }

    // arms rest
    const REST = 0.9;
    const ELBOW = 0.35;
    const restZL = -raiseL * REST;
    const restZR = -raiseR * REST;

    if (lUpperArm) { lUpperArm.rotation.z = restZL + Math.sin(tRef.current * 0.7) * 0.025; lUpperArm.rotation.x = Math.sin(tRef.current * 0.55) * 0.02; lUpperArm.rotation.y = 0; }
    if (rUpperArm) { rUpperArm.rotation.z = restZR + Math.sin(tRef.current * 0.75 + 0.4) * 0.025; rUpperArm.rotation.x = Math.sin(tRef.current * 0.6) * 0.02; rUpperArm.rotation.y = 0; }
    if (lLowerArm) lLowerArm.rotation.x = ELBOW + Math.sin(tRef.current * 0.85) * 0.03;
    if (rLowerArm) rLowerArm.rotation.x = ELBOW + Math.sin(tRef.current * 0.9 + 0.25) * 0.03;
    if (lHand) { lHand.rotation.y = Math.sin(tRef.current * 1.0) * 0.08; lHand.rotation.x = Math.sin(tRef.current * 0.5) * 0.04; }
    if (rHand) { rHand.rotation.y = Math.sin(tRef.current * 1.05 + 0.35) * 0.08; rHand.rotation.x = Math.sin(tRef.current * 0.55 + 0.2) * 0.04; }
    if (lShoulder) lShoulder.rotation.z =  0.035 * (raiseL === +1 ? 1 : -1) + Math.sin(tRef.current * 0.7) * 0.015;
    if (rShoulder) rShoulder.rotation.z =  0.035 * (raiseR === -1 ? 1 : -1) + Math.sin(tRef.current * 0.75 + 0.45) * 0.015;

    // tiny wave when speaking
    const g = gestureRef.current;
    if (!speaking) { g.active = false; g.next = 2.5; }
    else {
      g.next -= delta * 1.1;
      if (!g.active && g.next <= 0) {
        g.active = true; g.side = Math.random() < 0.5 ? "left" : "right";
        g.t = 0; g.dur = 1.1 + Math.random() * 0.4; g.next = 3.0 + Math.random() * 2.0;
      }
      if (g.active) {
        g.t += delta;
        const k = easeInOut(g.t / g.dur);
        const LIFT = 0.45 * k, BEND = ELBOW + 0.45 * k, WRIST = 0.55 * Math.sin(tRef.current * 10) * k;
        if (g.side === "left") {
          if (lUpperArm) { lUpperArm.rotation.z = restZL + raiseL * LIFT; lUpperArm.rotation.y = -0.18 * k; }
          if (lLowerArm) lLowerArm.rotation.x = BEND;
          if (lHand) { lHand.rotation.y = WRIST; lHand.rotation.x = 0.25 * k; }
        } else {
          if (rUpperArm) { rUpperArm.rotation.z = restZR + raiseR * LIFT; rUpperArm.rotation.y = 0.18 * k; }
          if (rLowerArm) rLowerArm.rotation.x = BEND;
          if (rHand) { rHand.rotation.y = -WRIST; rHand.rotation.x = 0.25 * k; }
        }
        if (g.t >= g.dur) g.active = false;
      }
    }

    // mouth + blink
    if (em) {
      em.setValue("ih", 0); em.setValue("ou", 0); em.setValue("ee", 0); em.setValue("oh", 0);
      let mouth = 0.02 + Math.max(0, Math.sin(tRef.current * 1.2)) * 0.01;
      if (speaking) {
        const s1 = (Math.sin(tRef.current * 8.0) + 1) * 0.5;
        const s2 = (Math.sin(tRef.current * 3.7 + 1.3) + 1) * 0.5;
        const s3 = (Math.sin(tRef.current * 1.9 + 0.7) + 1) * 0.5;
        mouth = 0.05 + (0.65 * s1 + 0.25 * s2 + 0.10 * s3) * 0.8;
        mouth = Math.min(1, Math.max(0, mouth));
      }
      em.setValue("aa", mouth);

      const B = blinkRef.current;
      B.t += delta;
      if (B.phase === 0 && B.t > B.nextBlink) B.phase = 1;
      if (B.phase === 1) { B.v += delta * 12; if (B.v >= 1) { B.v = 1; B.phase = 2; } }
      else if (B.phase === 2) { B.v -= delta * 10; if (B.v <= 0) { B.v = 0; B.phase = 0; B.t = 0; B.nextBlink = 1.5 + Math.random() * 2.0; }
      em.setValue("blink", clamp01(B.v));
      em.update();
    }

    vrm.springBoneManager?.update(delta);
    vrm.update?.(delta);
    if (groupRef.current) groupRef.current.rotation.y = Math.sin(tRef.current * 0.2) * 0.05;
  }});

  return (
    <group ref={groupRef}>
      <LookAtTarget vrm={vrm} />
      <primitive object={vrm ? vrm.scene : new THREE.Group()} />
    </group>
  );
}

// ---------- Main Component ----------
const TalkingAvatar = () => {
  const [vrm, setVrm] = useState(null);
  const [loadingAvatar, setLoadingAvatar] = useState(true);
  const [error, setError] = useState("");

  const [speaking, setSpeaking] = useState(false);

  // STT state
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");

  // TTS voice
  const [voiceList, setVoiceList] = useState([]);
  const [voiceName, setVoiceName] = useState("");

  // NEW: auto-restart + TTS mute coordination
  const manualPauseRef = useRef(false);
  const restartTimerRef = useRef(null);
  const micPausedForTTSRef = useRef(false);

  // Load VRM
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const model = await loadVRM(VRM_URL);
        if (!mounted) return;
        setVrm(model);
      } catch (e) {
        console.warn("No default VRM at", VRM_URL, e?.message || e);
        setError("No default avatar loaded.");
      } finally {
        setLoadingAvatar(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Voices
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoiceList(v);
      if (!voiceName) {
        const en = v.find((vv) => /^en[-_]/i.test(vv.lang));
        if (en) setVoiceName(en.name);
      }
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, [voiceName]);

  // ---------- helpers ----------
  const cleanUserText = (txt) =>
    txt.replace(/\b(you said|you say)\b[:,\s]*/gi, "").replace(/\s+/g, " ").trim();

  const cleanServerText = (txt) =>
    txt.replace(/^\s*(you said|you say)\s*[:,-]?\s*/i, "").replace(/\s+/g, " ").trim();

  // Build API URL that works on desktop & phone
  const API_URL = React.useMemo(() => {
    if (process.env.REACT_APP_API_BASE) {
      return `${process.env.REACT_APP_API_BASE.replace(/\/$/, "")}/chat_llm/send`;
    }
    const proto = window.location.protocol;               // http: or https:
    const host = window.location.hostname;                // e.g. 192.168.1.23
    const port = 8000;                                    // FastAPI port
    return `${proto}//${host}:${port}/chat_llm/send`;
  }, []);

  // HARD mute mic during TTS; auto-restart STT after TTS finishes
  const speakText = (text) => {
    if (!("speechSynthesis" in window) || !text?.trim()) return;

    // fully stop STT so it can't capture TTS
    try {
      if (recognitionRef.current) {
        micPausedForTTSRef.current = true;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort(); // no final flush
      }
    } catch {}
    setListening(false);

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const chosen = voiceList.find((v) => v.name === voiceName);
    if (chosen) u.voice = chosen;
    u.lang = chosen?.lang || "en-US";
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;

    const finish = () => {
      setSpeaking(false);
      micPausedForTTSRef.current = false;
      // Immediately restart STT unless user paused manually
      if (!manualPauseRef.current) startListening(true);
    };

    u.onstart = () => setSpeaking(true);
    u.onend = finish;
    u.onerror = finish;

    window.speechSynthesis.speak(u);
  };

  const sendToServer = async (msg) => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} ${res.statusText} – ${body.slice(0,200)}`);
      }
      const text = await res.text();
      let reply = text;
      try {
        const j = JSON.parse(text);
        reply = j?.message ?? j?.payload ?? text;
      } catch { /* keep raw */ }
      reply = cleanServerText(String(reply || ""));
      return reply || "";
    } catch (e) {
      console.error(e);
      setError(`Request failed: ${e?.message || e} (API: ${API_URL})`);
      return "";
    }
  };

  // ---------- STT ----------
  const startListening = (silentStart = false) => {
    const SR = getSR();
    if (!SR) {
      setError("Speech Recognition API not supported in this browser.");
      return;
    }
    if (!hasSecureContext()) {
      setError("Use HTTPS (or localhost) for mic access.");
      return;
    }
    // don't start while avatar is speaking
    if (listening || speaking) return;

    manualPauseRef.current = false;
    clearTimeout(restartTimerRef.current);

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    if (!silentStart) setInterim(""); // keep prior finals

    rec.onstart = () => setListening(true);

    rec.onresult = async (e) => {
      if (speaking) return;

      let interimBuf = "";
      let finalBuf = finalText;

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const chunk = (res[0]?.transcript ?? "").trim();
        if (!chunk) continue;

        if (res.isFinal) {
          const cleaned = cleanUserText(chunk);
          if (!cleaned) continue;

          finalBuf = (finalBuf ? finalBuf + " " : "") + cleaned;
          setFinalText(finalBuf);

          const reply = await sendToServer(cleaned);
          if (reply) speakText(reply);
        } else {
          interimBuf += " " + chunk;
        }
      }
      setInterim(interimBuf.trim());
    };

    rec.onerror = (ev) => {
      setListening(false);
      const shouldRestart =
        !manualPauseRef.current &&
        !speaking &&
        !micPausedForTTSRef.current &&
        ev?.error !== "aborted";
      if (shouldRestart) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => startListening(true), 150);
      }
    };

    rec.onend = () => {
      setListening(false);
      const shouldRestart =
        !manualPauseRef.current &&
        !speaking &&
        !micPausedForTTSRef.current;
      if (shouldRestart) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => startListening(true), 150);
      }
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const pauseListening = () => {
    manualPauseRef.current = true;
    clearTimeout(restartTimerRef.current);
    try { recognitionRef.current?.abort?.(); } catch {}
    setListening(false);
  };

  // ----------------------------------------------------------------
  return (
    <Card className="shadow-sm p-4 mx-auto mt-4" style={{ maxWidth: "900px", width: "100%" }}>
      <h3 className="text-center text-primary fw-bold mb-3">Avatar: Talk ↔ Server ↔ Talk-back</h3>
      <p className="text-center text-muted mb-3">
        Start talking; each finalized phrase goes to <code>/chat_llm/send</code>.
        The avatar speaks the server reply (mic is muted during TTS and auto-restarts after silence).
      </p>

      {error && <Alert variant="warning">{error}</Alert>}

      <Row className="g-3 mb-3 align-items-end">
        <Col sm="auto">
          <div className="d-flex gap-2">
            <Button
              variant={listening ? "outline-success" : "success"}
              onClick={async () => {
                manualPauseRef.current = false;
                clearTimeout(restartTimerRef.current);
                if (!hasSecureContext()) {
                  setError("Speech recognition requires HTTPS (or localhost). Open this page via https:// on your phone.");
                  return;
                }
                const SR = getSR();
                if (!SR) {
                  setError("This browser doesn't support Web Speech Recognition. On mobile, use Chrome on Android or switch to server STT.");
                  return;
                }
                const ok = await unlockMobileAudio();
                if (!ok) {
                  setError("Microphone permission is needed to start listening.");
                  return;
                }
                startListening(false);
              }}
              disabled={listening || loadingAvatar || !vrm || speaking}
            >
              {listening ? "Listening…" : "Start"}
            </Button>
            <Button variant="secondary" onClick={pauseListening} disabled={!listening}>
              Pause
            </Button>
          </div>
          <div className="mt-2">
            <Badge bg={listening ? "success" : "secondary"}>{listening ? "Mic ON" : "Mic OFF"}</Badge>{" "}
            <Badge bg={speaking ? "primary" : "secondary"}>{speaking ? "Avatar Speaking" : "Idle"}</Badge>
          </div>
        </Col>

        <Col sm>
          <div className="small text-muted mb-1">Voice used for TTS (server reply)</div>
          <select className="form-select" value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
            {voiceList.length === 0 && <option value="">(Loading voices…)</option>}
            {voiceList.map((v) => (
              <option key={`${v.name}-${v.lang}`} value={v.name}>
                {v.name} — {v.lang}{v.default ? " (default)" : ""}
              </option>
            ))}
          </select>
        </Col>
      </Row>

      <div className="mb-3">
        <div className="p-2 border rounded bg-light">
          <div className="small text-muted mb-1">You said (finalized):</div>
          <div className="fw-semibold" style={{ minHeight: 22 }}>{finalText}</div>
          <div className="small text-muted mt-2">Interim:</div>
          <div style={{ minHeight: 20 }}>{interim}</div>
        </div>
      </div>

      <div className="rounded overflow-hidden" style={{ height: 480, background: "#0b1220" }}>
        <Canvas camera={{ position: [0, 1.3, 1.0], fov: 25 }}>
          <color attach="background" args={["#0b1220"]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 3, 2]} intensity={1.0} />
          <VRMScene vrm={vrm} speaking={speaking} />
          <OrbitControls enablePan={false} minDistance={0.8} maxDistance={2.5} target={[0, 1.4, 0]} />
        </Canvas>
      </div>

      <div className="text-center mt-3">
        {loadingAvatar ? (
          <small className="text-muted"><Spinner animation="border" size="sm" /> Loading avatar…</small>
        ) : vrm ? (
          <small className="text-muted">Avatar ready</small>
        ) : (
          <small className="text-muted">No avatar loaded</small>
        )}
      </div>
    </Card>
  );
};

export default TalkingAvatar;
