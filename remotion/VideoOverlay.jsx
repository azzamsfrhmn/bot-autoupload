/**
 * Teks di atas video yang sudah ada (hasil Flow): hook di awal, keunggulan di tengah, harga & CTA di akhir.
 * Suara asli video tetap dipakai.
 */
import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from 'remotion';
import { HookText, PointCard, PriceCta, Shade, resolveSrc } from './parts';

export const VideoOverlay = ({ videoSrc, hook, points, price, cta, accent }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const list = (points || []).filter(Boolean).slice(0, 3);

  // Video pendek (8 dtk Flow): bagi waktu proporsional
  const hookFrames = Math.min(Math.round(3 * fps), Math.round(durationInFrames * 0.3));
  const ctaFrames = Math.min(Math.round(3 * fps), Math.round(durationInFrames * 0.3));
  const middleFrames = Math.max(1, durationInFrames - hookFrames - ctaFrames);
  const perPoint = list.length ? Math.floor(middleFrames / list.length) : middleFrames;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {videoSrc ? (
        <OffthreadVideo src={resolveSrc(videoSrc)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : null}
      <Shade />

      <Sequence durationInFrames={hookFrames}>
        <HookText text={hook} accent={accent} />
      </Sequence>

      {list.map((text, i) => (
        <Sequence key={i} from={hookFrames + i * perPoint} durationInFrames={perPoint}>
          <PointCard index={i} text={text} accent={accent} />
        </Sequence>
      ))}

      <Sequence from={durationInFrames - ctaFrames}>
        <PriceCta price={price} cta={cta} accent={accent} />
      </Sequence>
    </AbsoluteFill>
  );
};
