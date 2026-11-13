/**
 * Konsep 3D Edukasi ("tahu gak sih"): klip animasi 3D dari Google Flow berurutan + narasi
 * + teks 2–4 kata yang muncul bergantian mengikuti narasi (gaya video penjelasan 3D) + label kecil di atas.
 * Narasi ada di dalam klip (diucapkan Veo) → suara klip dipakai; mode lama dengan audio terpisah tetap didukung.
 */
import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, resolveSrc } from './parts';

const softShadow = '0 3px 12px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.8)';

// Satu potongan teks: muncul cepat dengan sedikit naik
const CaptionChunk = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(frame, [0, 4], [12, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{
      position: 'absolute', left: 80, right: 80, top: 1230, textAlign: 'center',
      fontFamily: FONT, fontWeight: 700, fontSize: 64, lineHeight: 1.15, color: '#fff',
      textShadow: softShadow, opacity, transform: `translateY(${y}px)`
    }}>{text}</div>
  );
};

// Klip 3D satu adegan: diperlambat bila narasi lebih panjang dari klip, sedikit zoom pelan agar tetap hidup
const SceneClip = ({ src, clipDurSec, durSec, withAudio }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rate = clipDurSec > 0 && durSec > clipDurSec ? Math.max(0.5, clipDurSec / durSec) : 1;
  const zoom = interpolate(frame, [0, durSec * fps], [1, 1.06]);
  const fadeIn = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#000', opacity: fadeIn }}>
      <OffthreadVideo src={resolveSrc(src)} muted={!withAudio} playbackRate={withAudio ? 1 : rate}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
    </AbsoluteFill>
  );
};

export const Edu3D = ({ segments, audioSrc, label }) => {
  const { fps } = useVideoConfig();
  let cursor = 0;
  const placed = (segments || []).map((s) => {
    const from = cursor;
    const frames = Math.max(fps, Math.round((Number(s.durSec) || 1) * fps));
    cursor += frames;
    return { ...s, from, frames };
  });

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {placed.map((s, i) => (
        <Sequence key={`clip${i}`} from={s.from} durationInFrames={s.frames}>
          <SceneClip src={s.clipSrc} clipDurSec={Number(s.clipDurSec) || 0} durSec={s.frames / fps} withAudio={Boolean(s.clipAudio)} />
          {s.audioSrc ? <Audio src={resolveSrc(s.audioSrc)} /> : null}
          {(s.captions || []).map((c, j) => {
            const start = Math.round((Number(c.startSec) || 0) * fps);
            const len = Math.max(4, Math.round(((Number(c.endSec) || 0) - (Number(c.startSec) || 0)) * fps));
            return (
              <Sequence key={`cap${j}`} from={start} durationInFrames={len}>
                <CaptionChunk text={c.text} />
              </Sequence>
            );
          })}
        </Sequence>
      ))}

      {audioSrc ? <Audio src={resolveSrc(audioSrc)} /> : null}

      {label ? (
        <div style={{
          position: 'absolute', left: 60, right: 60, top: 210, textAlign: 'center',
          fontFamily: FONT, fontWeight: 700, fontSize: 40, color: '#fff', textShadow: softShadow
        }}>{label}</div>
      ) : null}
    </AbsoluteFill>
  );
};
