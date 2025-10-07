// src/components/avatar/TalkingAvatar.jsx
import React, { useEffect, useRef, useState } from "react";
import { Card, Form, Button, Alert, Spinner, Row, Col } from "react-bootstrap";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRM,
  VRMUtils,
  VRMLoaderPlugin,
  VRMHumanBoneName,
} from "@pixiv/three-vrm";

// const VRM_URL = "/avatars/si0JK_MIHIRO.vrm";
const VRM_URL = "/avatars/4876888923308523849.vrm";

// ---------- VRM Loader ----------
async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("Loaded GLTF does not contain a VRM model.");
  VRMUtils.removeUnnecessaryJoints(vrm.scene);
  vrm.scene.traverse((obj) => (obj.frustumCulled = false));
  // Face forward (remove the 180° flip)
  vrm.scene.rotation.y = 0; // ← change this to Math.PI if your avatar faces away
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
function VRMScene({ vrm, speaking, gestures }) {
  const groupRef = useRef(null);
  const tRef = useRef(0);

  // normalized bones
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

  // Blink
  const blinkRef = useRef({ t: 0, nextBlink: 1.5 + Math.random() * 2.0, phase: 0, v: 0 });

  // Gesture scheduler
  const gestureRef = useRef({ active: false, side: "right", t: 0, dur: 1.2, next: 2.5 });

  // Per-arm “raise” direction
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

    // --- One-time arm axis auto-calibration ---
    if (!dirRef.current.done && lUpperArm && rUpperArm && lHand && rHand && lShoulder && rShoulder) {
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

    // ----- Idle body sway -----
    if (spine) { spine.rotation.x = Math.sin(tRef.current * 1.2) * 0.01; spine.rotation.y = Math.sin(tRef.current * 0.7) * 0.01; }
    if (chest) { chest.rotation.x = Math.sin(tRef.current * 1.0) * 0.015; chest.rotation.y = Math.sin(tRef.current * 0.5) * 0.012; }
    if (neck)  { neck.rotation.x = Math.sin(tRef.current * 0.9) * 0.02;   neck.rotation.y = Math.sin(tRef.current * 0.6 + 0.5) * 0.02; }
    if (head)  { head.rotation.x = Math.sin(tRef.current * 1.1 + 0.3) * 0.018; head.rotation.y = Math.sin(tRef.current * 0.8) * 0.018; }

    // ----- Arms REST (down) + tiny sway -----
    const REST = 0.9;
    const ELBOW = 0.35;

    const restZL = -raiseL * REST;
    const restZR = -raiseR * REST;

    if (lUpperArm) {
      lUpperArm.rotation.z = restZL + Math.sin(tRef.current * 0.7) * 0.025;
      lUpperArm.rotation.x = Math.sin(tRef.current * 0.55) * 0.02;
      lUpperArm.rotation.y = 0;
    }
    if (rUpperArm) {
      rUpperArm.rotation.z = restZR + Math.sin(tRef.current * 0.75 + 0.4) * 0.025;
      rUpperArm.rotation.x = Math.sin(tRef.current * 0.6) * 0.02;
      rUpperArm.rotation.y = 0;
    }

    if (lLowerArm) lLowerArm.rotation.x = ELBOW + Math.sin(tRef.current * 0.85) * 0.03;
    if (rLowerArm) rLowerArm.rotation.x = ELBOW + Math.sin(tRef.current * 0.9 + 0.25) * 0.03;

    if (lHand) { lHand.rotation.y = Math.sin(tRef.current * 1.0) * 0.08; lHand.rotation.x = Math.sin(tRef.current * 0.5) * 0.04; }
    if (rHand) { rHand.rotation.y = Math.sin(tRef.current * 1.05 + 0.35) * 0.08; rHand.rotation.x = Math.sin(tRef.current * 0.55 + 0.2) * 0.04; }

    if (lShoulder) lShoulder.rotation.z =  0.035 * (raiseL === +1 ? 1 : -1) + Math.sin(tRef.current * 0.7) * 0.015;
    if (rShoulder) rShoulder.rotation.z =  0.035 * (raiseR === -1 ? 1 : -1) + Math.sin(tRef.current * 0.75 + 0.45) * 0.015;

    // ----- Optional wave gesture (ONLY if gestures && speaking) -----
    const g = gestureRef.current;
    if (!(gestures && speaking)) {
      g.active = false;
      g.next = 2.5;
    } else {
      g.next -= delta * 1.0;
      if (!g.active && g.next <= 0) {
        g.active = true;
        g.side   = Math.random() < 0.5 ? "left" : "right";
        g.t      = 0;
        g.dur    = 1.1 + Math.random() * 0.4;
        g.next   = 3.0 + Math.random() * 2.0;
      }
      if (g.active) {
        g.t += delta;
        const k = easeInOut(g.t / g.dur);
        const LIFT  = 0.45 * k;
        const BEND  = ELBOW + 0.45 * k;
        const WRIST = 0.55 * Math.sin(tRef.current * 10) * k;

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

    // ----- Mouth + blink -----
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
      else if (B.phase === 2) { B.v -= delta * 10; if (B.v <= 0) { B.v = 0; B.phase = 0; B.t = 0; B.nextBlink = 1.5 + Math.random() * 2.0; } }
      em.setValue("blink", clamp01(B.v));
      em.update();
    }

    vrm.springBoneManager?.update(delta);
    vrm.update?.(delta);

    if (groupRef.current) groupRef.current.rotation.y = Math.sin(tRef.current * 0.2) * 0.05;
  });

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
  const [text, setText] = useState("Hello, I’m your Patient AI avatar. Nice to meet you!");
  const [speaking, setSpeaking] = useState(false);

  // gestures toggle (off by default)
  const [gestures, setGestures] = useState(false);

  // voices
  const [voiceList, setVoiceList] = useState([]);
  const [voiceName, setVoiceName] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const model = await loadVRM(VRM_URL);
        if (!mounted) return;
        setVrm(model);
      } catch (e) {
        console.warn("No default VRM at", VRM_URL, e?.message || e);
        setError("No default avatar loaded. Use the file picker to load a .vrm.");
      } finally {
        setLoadingAvatar(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

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

  const speak = () => {
    if (!("speechSynthesis" in window)) {
      setError("Web Speech API not supported in this browser.");
      return;
    }
    if (!text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const chosen = voiceList.find((v) => v.name === voiceName);
    if (chosen) u.voice = chosen;
    u.lang = chosen?.lang || "en-US";
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  return (
    <Card className="shadow-sm p-4 mx-auto mt-4" style={{ maxWidth: "900px", width: "100%" }}>
      <h3 className="text-center text-primary fw-bold mb-3">Avatar: Web TTS Demo</h3>
      <p className="text-center text-muted mb-3">
        Idle sway + blink are always on. Toggle gestures for occasional waves while speaking.
      </p>

      {error && <Alert variant="warning">{error}</Alert>}

      <Form.Group className="mb-2">
        <Form.Check
          type="switch"
          id="gestures-switch"
          label="Gestures while speaking"
          checked={gestures}
          onChange={(e) => setGestures(e.target.checked)}
        />
      </Form.Group>

      {/* Load any .vrm from disk */}
      <Form.Group className="mb-3">
        <Form.Label>Load a <code>.vrm</code> file</Form.Label>
        <Form.Control
          type="file"
          accept=".vrm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setLoadingAvatar(true);
            setError("");
            try {
              const objectUrl = URL.createObjectURL(file);
              const model = await loadVRM(objectUrl);
              setVrm(model);
            } catch (err) {
              console.error(err);
              setError(err?.message || "Failed to load VRM.");
            } finally {
              setLoadingAvatar(false);
            }
          }}
        />
        <Form.Text muted>
          You can also place a default file at <code>public/avatars/avatar.vrm</code>.
        </Form.Text>
      </Form.Group>

      <Row className="g-3 mb-3">
        <Col md={8}>
          <Form.Control
            as="textarea"
            rows={2}
            placeholder="Type something for the avatar to say…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Col>
        <Col md={4}>
          <Form.Group>
            <Form.Label>Voice</Form.Label>
            <Form.Select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
              {voiceList.length === 0 && <option value="">(Loading voices…)</option>}
              {voiceList.map((v) => (
                <option key={`${v.name}-${v.lang}`} value={v.name}>
                  {v.name} — {v.lang}{v.default ? " (default)" : ""}
                </option>
              ))}
            </Form.Select>
            <Form.Text muted>
              Availability varies by OS/browser. Pick a different voice to change tone/gender.
            </Form.Text>
          </Form.Group>
        </Col>
      </Row>

      <div className="d-grid mb-3">
        <Button variant="success" onClick={speak} disabled={speaking || loadingAvatar || !vrm}>
          {speaking ? (<><Spinner animation="border" size="sm" /> Speaking…</>) : ("Speak")}
        </Button>
      </div>

      <div className="rounded overflow-hidden" style={{ height: 480, background: "#0b1220" }}>
        <Canvas camera={{ position: [0, 1.3, 1.0], fov: 25 }}>
          <color attach="background" args={["#0b1220"]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 3, 2]} intensity={1.0} />
          <VRMScene vrm={vrm} speaking={speaking} gestures={gestures} />
          <OrbitControls enablePan={false} minDistance={0.8} maxDistance={2.5} target={[0, 1.4, 0]} />
        </Canvas>
      </div>

      <div className="text-center mt-3">
        {loadingAvatar ? (
          <small className="text-muted"><Spinner animation="border" size="sm" /> Loading avatar…</small>
        ) : vrm ? (
          <small className="text-muted">Avatar ready</small>
        ) : (
          <small className="text-muted">Load a .vrm to begin</small>
        )}
      </div>
    </Card>
  );
};

export default TalkingAvatar;
