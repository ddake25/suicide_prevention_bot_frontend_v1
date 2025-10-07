// src/components/avatar/TalkingAvatar.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Form, Button, Alert, Spinner, Row, Col } from "react-bootstrap";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// ⬇️ CHANGED: include VRMLoaderPlugin
import { VRM, VRMUtils, VRMLoaderPlugin } from "@pixiv/three-vrm";

/**
 * Notes:
 * - Option A: load any .vrm from your computer using the file picker below.
 * - (Optional) You can still place a default VRM at /public/avatars/avatar.vrm and it will auto-load if present.
 * - Uses Web Speech API (Chrome/Edge; limited Firefox support).
 * - Simulates mouth motion while TTS is speaking.
 */

const VRM_URL = "/avatars/4876888923308523849.vrm";

// ---------- VRM Loader (robust, with plugin) ----------
async function loadVRM(url) {
  const loader = new GLTFLoader();
  // enable VRM parsing
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url);
  // VRM instance is attached by the plugin:
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("Loaded GLTF does not contain a VRM model.");

  VRMUtils.removeUnnecessaryJoints(vrm.scene);
  vrm.scene.traverse((obj) => (obj.frustumCulled = false));
  return vrm;
}

// ---------- Scene with VRM (JS) ----------
function VRMScene({ vrm, speaking }) {
  const groupRef = useRef(null);
  const tRef = useRef(0);

  useFrame((_, delta) => {
    if (!vrm) return;
    tRef.current += delta;

    const em = vrm.expressionManager;
    if (!em) return;

    // reset other mouth shapes
    em.setValue("ih", 0);
    em.setValue("ou", 0);
    em.setValue("ee", 0);
    em.setValue("oh", 0);

    // base idle
    let mouth = 0.02 + Math.max(0, Math.sin(tRef.current * 1.2)) * 0.01;

    // talk animation
    if (speaking) {
      const s1 = (Math.sin(tRef.current * 8.0) + 1) * 0.5;
      const s2 = (Math.sin(tRef.current * 3.7 + 1.3) + 1) * 0.5;
      const s3 = (Math.sin(tRef.current * 1.9 + 0.7) + 1) * 0.5;
      mouth = 0.05 + (0.65 * s1 + 0.25 * s2 + 0.10 * s3) * 0.8;
      mouth = Math.min(1, Math.max(0, mouth));
    }

    // apply to open mouth
    em.setValue("aa", mouth);
    em.update();

    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(tRef.current * 0.2) * 0.05;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={vrm ? vrm.scene : new THREE.Group()} />
    </group>
  );
}

// ---------- Main Component (JS) ----------
const TalkingAvatar = () => {
  const [vrm, setVrm] = useState(null);
  const [loadingAvatar, setLoadingAvatar] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState(
    "Hello, I’m your Patient AI avatar. Nice to meet you!"
  );
  const [speaking, setSpeaking] = useState(false);
  const [voiceName, setVoiceName] = useState("");

  // Try to auto-load a default VRM if it exists (optional)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const model = await loadVRM(VRM_URL);
        if (!mounted) return;
        setVrm(model);
      } catch (e) {
        // No default VRM found or failed to load — that's OK for Option A
        console.warn("No default VRM at", VRM_URL, e?.message || e);
        setError("No default avatar loaded. Use the file picker to load a .vrm.");
      } finally {
        setLoadingAvatar(false);
      }
    })();
    return () => {
      mounted = false;
      if (vrm) {
        vrm.scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose?.();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
              m.map?.dispose?.();
              m.dispose?.();
            });
          }
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // system voices (optional)
  const voices = useMemo(() => {
    if (!("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices();
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const handler = () => setVoiceName((v) => v);
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
    };
  }, []);

  const speak = () => {
    if (!("speechSynthesis" in window)) {
      setError("Web Speech API not supported in this browser.");
      return;
    }
    if (!text.trim()) return;

    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    const vs = window.speechSynthesis.getVoices();
    const chosen = vs.find((v) => v.name === voiceName);
    if (chosen) u.voice = chosen;

    u.rate = 1.0;
    u.pitch = 1.0;

    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(u);
  };

  return (
    <Card className="shadow-sm p-4 mx-auto mt-4" style={{ maxWidth: "900px", width: "100%" }}>
      <h3 className="text-center text-primary fw-bold mb-3">Avatar: Web TTS Demo</h3>
      <p className="text-center text-muted mb-3">
        Type text below and click <strong>Speak</strong>. The avatar will animate mouth movements while speaking.
      </p>

      {error && <Alert variant="warning">{error}</Alert>}

      {/* ⬇️ NEW: File picker to load any .vrm from disk */}
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
          Pick any VRM model file. You can also place a default file at <code>public/avatars/avatar.vrm</code>.
        </Form.Text>
      </Form.Group>

      <Row className="g-3 mb-3">
        <Col md={9}>
          <Form.Control
            as="textarea"
            rows={2}
            placeholder="Type something for the avatar to say…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Col>
        <Col md={3} className="d-grid">
          <Button variant="success" onClick={speak} disabled={speaking || loadingAvatar || !vrm}>
            {speaking ? (
              <>
                <Spinner animation="border" size="sm" /> Speaking…
              </>
            ) : (
              "Speak"
            )}
          </Button>
        </Col>
      </Row>

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
          <small className="text-muted">
            <Spinner animation="border" size="sm" /> Loading avatar…
          </small>
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
