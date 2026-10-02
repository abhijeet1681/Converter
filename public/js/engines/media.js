// Audio/Video engine — FFmpeg compiled to WebAssembly, runs fully in the browser
import { loadScript, extOf, baseName } from '../utils.js';

let ffmpeg = null, loading = null, onProgress = null, queue = Promise.resolve();
const logs = [];
const MIME = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  gif: 'image/gif', png: 'image/png', webp: 'image/webp',
};
const AUDIO = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi']);

async function getFFmpeg(ctx) {
  if (ffmpeg) return ffmpeg;
  if (!loading) {
    loading = (async () => {
      ctx?.log?.('Loading FFmpeg engine (first time only)…');
      await loadScript('/vendor/ffmpeg/ffmpeg.js');
      const inst = new window.FFmpegWASM.FFmpeg();
      inst.on('log', ({ message }) => { logs.push(message); if (logs.length > 300) logs.shift(); });
      inst.on('progress', ({ progress }) => { if (onProgress && progress >= 0 && progress <= 1) onProgress(progress); });
      const base = new URL('/vendor/ffmpeg-core/', location.href).href;
      await inst.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
      ffmpeg = inst;
      return inst;
    })().catch(e => { loading = null; throw new Error('Could not start FFmpeg: ' + (e?.message || e)); });
  }
  return loading;
}

/** Run one FFmpeg job (jobs are queued: FFmpeg has a single virtual file system). */
export async function runFFmpeg(file, outExt, args, ctx, preArgs = []) {
  const ff = await getFFmpeg(ctx);
  const job = async () => {
    const id = Math.random().toString(36).slice(2, 8);
    const inName = `in_${id}.${extOf(file.name || '') || 'bin'}`;
    const outName = `out_${id}.${outExt}`;
    ctx?.log?.('Reading file…');
    await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    onProgress = p => ctx?.progress?.(p);
    logs.length = 0;
    ctx?.log?.('Converting…');
    try {
      const code = await ff.exec([...preArgs, '-i', inName, ...args, '-y', outName]);
      let data = null;
      try { data = await ff.readFile(outName); } catch { /* no output */ }
      if (code !== 0 || !data || !data.length) {
        const hint = logs.filter(l => /error|invalid|not|unknown|unsupported/i.test(l)).slice(-2).join(' | ');
        throw new Error('Conversion failed' + (hint ? `: ${hint}` : '. The file may be damaged or use an unsupported codec.'));
      }
      return new Blob([data], { type: MIME[outExt] || 'application/octet-stream' });
    } finally {
      onProgress = null;
      try { await ff.deleteFile(inName); } catch { /* ignore */ }
      try { await ff.deleteFile(outName); } catch { /* ignore */ }
    }
  };
  const result = queue.then(job, job);
  queue = result.catch(() => {});
  return result;
}

function parseTime(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) throw new Error(`Invalid time "${s}". Use seconds (90), mm:ss (1:30) or hh:mm:ss.`);
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3];
}
function trimArgs(o) {
  const s = parseTime(o.start), e = parseTime(o.end);
  if (s != null && e != null && e <= s) throw new Error('End time must be after start time.');
  return { pre: s ? ['-ss', String(s)] : [], post: e != null ? ['-t', String(e - (s || 0))] : [] };
}
const outName = (file, ext, suffix) => `${baseName(file.name)}${suffix ? '-' + suffix : ''}.${ext}`;

export async function convertAudio(file, o, ctx) {
  const src = extOf(file.name);
  const to = o.to === 'same' ? (AUDIO.has(src) ? src : 'mp3') : o.to;
  const br = o.bitrate || '192k';
  const codec = {
    mp3: ['-c:a', 'libmp3lame', '-b:a', br], wav: ['-c:a', 'pcm_s16le'], m4a: ['-c:a', 'aac', '-b:a', br], aac: ['-c:a', 'aac', '-b:a', br],
    ogg: ['-c:a', 'libvorbis', '-b:a', br], flac: ['-c:a', 'flac'], opus: ['-c:a', 'libopus', '-b:a', br],
  }[to];
  if (!codec) throw new Error(`Unsupported audio format: ${to}`);
  const args = ['-vn', ...codec];
  if (o.sampleRate && to !== 'opus') args.push('-ar', String(o.sampleRate));
  if (o.channels) args.push('-ac', String(o.channels));
  if (o.volume && +o.volume !== 1) args.push('-af', `volume=${+o.volume}`);
  const { pre, post } = trimArgs(o);
  const blob = await runFFmpeg(file, to, [...post, ...args], ctx, pre);
  return [{ name: outName(file, to, o.suffix), blob }];
}

export async function convertVideo(file, o, ctx) {
  const src = extOf(file.name);
  const to = o.to === 'same' ? (VIDEO.has(src) ? src : 'mp4') : o.to;
  const { pre, post } = trimArgs(o);
  let args;
  if (to === 'gif') {
    const fps = +o.fps || 12;
    const w = o.gifWidth === 'keep' ? 'iw' : (+o.gifWidth || 480);
    args = ['-vf', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`, '-loop', '0', '-an'];
  } else {
    const q = o.quality || 'medium';
    const vf = [];
    if (o.resolution && o.resolution !== 'keep') vf.push(`scale=-2:'min(${+o.resolution},ih)'`);
    let v, a;
    if (to === 'webm') {
      v = ['-c:v', 'libvpx', '-b:v', { high: '2500k', medium: '1000k', low: '500k' }[q], '-deadline', 'realtime', '-cpu-used', '8'];
      a = ['-c:a', 'libvorbis', '-b:a', '128k'];
    } else if (to === 'avi') {
      v = ['-c:v', 'mpeg4', '-q:v', String({ high: 3, medium: 6, low: 10 }[q])];
      a = ['-c:a', 'libmp3lame', '-b:a', '192k'];
    } else {
      vf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2'); // H.264 needs even dimensions
      v = ['-c:v', 'libx264', '-preset', o.speed || 'veryfast', '-crf', String({ high: 20, medium: 26, low: 31 }[q]), '-pix_fmt', 'yuv420p'];
      a = ['-c:a', 'aac', '-b:a', '128k'];
    }
    args = [...(vf.length ? ['-vf', vf.join(',')] : []), ...v, ...(o.mute ? ['-an'] : a)];
    if (to === 'mp4' || to === 'mov') args.push('-movflags', '+faststart');
  }
  const blob = await runFFmpeg(file, to, [...post, ...args], ctx, pre);
  return [{ name: outName(file, to, o.suffix), blob }];
}

export async function trimVideo(file, o, ctx) {
  const src = extOf(file.name) || 'mp4';
  const { pre, post } = trimArgs(o);
  const reencode = !!o.precise;
  const to = reencode && !['mp4', 'mov', 'mkv'].includes(src) ? 'mp4' : src;
  const args = reencode
    ? [...post, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
    : [...post, '-c', 'copy', '-avoid_negative_ts', 'make_zero'];
  const blob = await runFFmpeg(file, to, args, ctx, pre);
  return [{ name: outName(file, to, 'trimmed'), blob }];
}

export async function muteVideo(file, o, ctx) {
  const ext = extOf(file.name) || 'mp4';
  const blob = await runFFmpeg(file, ext, ['-c:v', 'copy', '-an'], ctx);
  return [{ name: outName(file, ext, 'muted'), blob }];
}
