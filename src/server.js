// // server.js
// require("dotenv").config();
// const express = require("express");
// const multer = require("multer");
// const cors = require("cors");

// // ⬇️ Xenova/transformers runs Whisper locally (WASM/ONNX)
// const { pipeline } = require("@xenova/transformers");

// const app = express();
// const upload = multer({ storage: multer.memoryStorage() });
// app.use(cors());

// // Lazy-load the ASR pipeline once (model downloaded on first call and cached)
// let asr = null;
// async function getASR() {
//   if (!asr) {
//     // Choose a model: small.en is fast+accurate for English
//     const modelId = process.env.WHISPER_MODEL || "Xenova/whisper-small.en";
//     // device: 'auto' (WASM/CPU). Node doesn’t have WebGPU yet.
//     asr = await pipeline("automatic-speech-recognition", modelId, { quantized: true });
//   }
//   return asr;
// }

// // POST /api/asr  -> returns { text }
// app.post("/api/asr", upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

//     const asr = await getASR();

//     // transformers expects a Float32Array/AudioBuffer or a typed array; it also accepts raw bytes
//     // We'll pass the raw buffer and hint the mime type to help decoding.
//     const result = await asr(req.file.buffer, {
//       // optional hints:
//       // chunk_length_s: 30,
//       // stride_length_s: 5,
//       // language: "en",
//       // task: "transcribe",
//       return_timestamps: false,
//     });

//     // result can be { text: "...", chunks: [...] } depending on model/options
//     const text = typeof result?.text === "string" ? result.text : "";
//     res.json({ text });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err?.message || "ASR failed" });
//   }
// });

// const PORT = process.env.PORT || 3001;
// app.listen(PORT, () => console.log(`ASR server listening at http://localhost:${PORT}`));

// // npm i express multer cors dotenv @xenova/transformers
