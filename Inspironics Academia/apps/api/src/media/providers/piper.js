import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { runFfmpeg } from '../video/ffmpeg.js';
import { createTempDir, releaseTempDir } from '../../files/tempStore.js';

// Piper (optional, local, free): runs the Piper executable with a voice model on this machine
// (PIPER_EXECUTABLE_PATH, PIPER_MODEL_PATH) and converts its WAV output to MP3 with FFmpeg. Keep it
// for light use: synthesis runs on the CPU of the API server.

export default {
  name: 'piper',
  ready: () => !!(config.tts.piper.executable && config.tts.piper.model && fs.existsSync(config.tts.piper.executable)),

  async synthesize({ text, rate }) {
    const dir = await createTempDir('piper');
    const wav = path.join(dir, 'speech.wav');
    const mp3 = path.join(dir, 'speech.mp3');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(config.tts.piper.executable, [
          '--model', config.tts.piper.model, '--output_file', wav,
          ...(rate && rate !== 1 ? ['--length_scale', String(+(1 / rate).toFixed(3))] : []),
        ], { windowsHide: true });
        let err = '';
        child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Piper failed (exit ${code}): ${err.trim().slice(-300)}`))));
        child.stdin.end(String(text));
      });
      await runFfmpeg(['-i', wav, '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '128k', mp3], { timeoutMs: 5 * 60_000 });
      return { bytes: await fsp.readFile(mp3), contentType: 'audio/mpeg' };
    } finally {
      await releaseTempDir(dir);
    }
  },

  async voices() {
    const model = config.tts.piper.model;
    return model ? [{ id: path.basename(model), name: path.basename(model, '.onnx'), languages: [], gender: '' }] : [];
  },
};
