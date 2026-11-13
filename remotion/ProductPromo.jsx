/**
 * Video dari foto produk, gaya edit affiliate TikTok: hook → 3 keunggulan → harga & CTA.
 * Foto selalu memenuhi layar 9:16. Dari tiap foto dibuat beberapa shot (penuh, setengah badan, detail bahan)
 * yang berganti cepat dengan punch zoom + kilat putih, jadi tetap dinamis walau hanya ada 1 foto.
 */
import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { HookText, PointCard, PriceCta, Shade, resolveSrc } from './parts';

const HOOK_SEC = 3;
const CTA_SEC = 3.5;
const SHOT_SEC = 1.6;

// Variasi framing dari satu foto: skala & titik fokus (persen). Fokus ke badan/baju, bukan wajah:
// penuh, badan atas, detail bahan di dada/perut, bagian bawah
const FRAMINGS = [
  { from: 1.0, to: 1.08, x: 50, y: 50 },
  { from: 1.4, to: 1.3, x: 50, y: 48 },
  { from: 1.7, to: 1.85, x: 50, y: 50 },
  { from: 1.25, to: 1.35, x: 48, y: 62 }
];

const Shot = ({ src, framing, durationInFrames }) => {
  const frame = useCurrentFrame();
  // Punch zoom di awal shot lalu gerak pelan
  const punch = interpolate(frame, [0, 6], [1.12, 1], { extrapolateRight: 'clamp' });
  const drift = interpolate(frame, [0, durationInFrames], [framing.from, framing.to]);
  return (
    <AbsoluteFill style={{ background: '#111', overflow: 'hidden' }}>
      <Img src={src} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
        objectPosition: `${framing.x}% ${framing.y}%`,
        transformOrigin: `${framing.x}% ${framing.y}%`,
        transform: `scale(${drift * punch})`
      }} />
    </AbsoluteFill>
  );
};

// Kilat putih singkat di setiap pergantian shot
const Flash = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 2, 5], [0.55, 0.25, 0], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: '#fff', opacity }} />;
};

// Garis progres tipis di atas (gaya video edit)
const ProgressBar = ({ accent }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, height: 10, width: `${(frame / durationInFrames) * 100}%`, background: accent }} />
  );
};

export const ProductPromo = ({ images, hook, points, price, cta, accent }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const photos = (images || []).filter(Boolean).map(resolveSrc);
  const list = (points || []).filter(Boolean).slice(0, 3);

  const hookFrames = Math.round(HOOK_SEC * fps);
  const ctaFrames = Math.round(CTA_SEC * fps);
  const middleFrames = Math.max(fps, durationInFrames - hookFrames - ctaFrames);
  const perPoint = list.length ? Math.floor(middleFrames / list.length) : middleFrames;

  // Daftar shot: foto bergiliran, framing bergiliran
  const shotFrames = Math.round(SHOT_SEC * fps);
  const shots = [];
  for (let i = 0, start = 0; start < durationInFrames; i++, start += shotFrames) {
    if (!photos.length) break;
    shots.push({
      start,
      src: photos[i % photos.length],
      framing: FRAMINGS[(i + Math.floor(i / photos.length)) % FRAMINGS.length]
    });
  }

  return (
    <AbsoluteFill style={{ background: '#111' }}>
      {shots.map((s, i) => (
        <Sequence key={`s${i}`} from={s.start} durationInFrames={shotFrames}>
          <Shot src={s.src} framing={s.framing} durationInFrames={shotFrames} />
          {i > 0 ? <Flash /> : null}
        </Sequence>
      ))}
      <Shade />
      <ProgressBar accent={accent} />

      <Sequence durationInFrames={hookFrames}>
        <HookText text={hook} />
      </Sequence>

      {list.map((text, i) => (
        <Sequence key={`t${i}`} from={hookFrames + i * perPoint} durationInFrames={perPoint}>
          <PointCard text={text} />
        </Sequence>
      ))}

      <Sequence from={durationInFrames - ctaFrames}>
        <PriceCta price={price} cta={cta} accent={accent} />
      </Sequence>
    </AbsoluteFill>
  );
};
