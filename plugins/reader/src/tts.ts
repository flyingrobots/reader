import { createConnection, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
export interface SpeechStatus { ok: boolean; accepting_speech?: boolean; playback_held?: boolean; interruption?: unknown; submission_guidance?: string }
export function speechAllowed(status: SpeechStatus) { return status.ok && status.accepting_speech === true && !status.playback_held && !status.interruption; }
export class SpeechClient {
  private sockets = new Set<Socket>();
  private disposed = false;
  private path: string;
  constructor(path = process.env.AI_TTS_SOCKET ?? join(process.env.AI_TTS_HOME ?? join(homedir(), 'Library/Application Support/ai-tts'), 'ai-tts.sock')) { this.path = path; }
  request<T>(payload: object): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Reader speech client is closed'));
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.path); this.sockets.add(socket);
      let buffer = '', settled = false;
      const finish = (error?: Error, value?: T) => { if (settled) return; settled = true; this.sockets.delete(socket); socket.destroy(); error ? reject(error) : resolve(value!); };
      socket.setTimeout(3000, () => finish(new Error('AI-TTS did not respond')));
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(JSON.stringify(payload) + '\n'));
      socket.on('error', error => finish(error));
      socket.on('close', () => finish(new Error('AI-TTS connection closed')));
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 2 * 1024 * 1024) { finish(new Error('AI-TTS response too large')); return; }
        if (!buffer.includes('\n')) return;
        try { const value = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))); if (!value.ok) throw new Error(value.error?.message ?? 'AI-TTS rejected the request'); finish(undefined, value); }
        catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
    });
  }
  dispose() { this.disposed = true; for (const socket of this.sockets) socket.destroy(); this.sockets.clear(); }
}
