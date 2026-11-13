// Komposisi Remotion "Kartun3D" (Dodo & Bongo): mesin canvas 3D low-poly + suara per adegan + musik latar.
// Props: { spec, timing, assetDir }  assetDir = folder staticFile (jobs/<id>) berisi NN_B.mp3 / NN_D.mp3 / musik.wav
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender } from 'remotion';
import createKartun3D from './kartun3d/kartun3d.js';
import { hitungTimeline } from './kartun3d/timeline.js';
// Font caption Inter ikut dibundel (tanpa internet saat render)
import interUrl from './kartun3d/Inter-latin.woff2';

export const KARTUN_FPS = 30;

let fontPromise = null;
function loadInter() {
  if (!fontPromise) {
    const face = new FontFace('Inter', `url(${interUrl}) format('woff2')`, { weight: '100 900', style: 'normal' });
    fontPromise = face.load().then((f) => { document.fonts.add(f); return document.fonts.ready; }).catch(() => null);
  }
  return fontPromise;
}

export const Kartun3D = ({ spec, timing, assetDir, musicVolume = 0.1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [handle] = useState(() => delayRender('Kartun3D: memuat font'));
  const [fontReady, setFontReady] = useState(false);
  const tl = useMemo(() => hitungTimeline(spec, timing), [spec, timing]);

  useEffect(() => {
    loadInter().finally(() => { setFontReady(true); continueRender(handle); });
  }, [handle]);

  useLayoutEffect(() => {
    if (!canvasRef.current || !fontReady) return;
    if (!engineRef.current) {
      engineRef.current = createKartun3D(canvasRef.current);
      engineRef.current.layout(spec, timing);
    }
    engineRef.current.renderFrame(frame / fps);
  }, [frame, fps, spec, timing, fontReady]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <canvas ref={canvasRef} width={1080} height={1920} style={{ width: '100%', height: '100%' }} />
      {tl.scenes.map((s, i) =>
        s.files.map((f) => (
          <Sequence key={i + f} from={Math.round(s.audioAt * fps)} durationInFrames={Math.ceil(((timing[i] && timing[i].end) || 1) * fps + fps)}>
            <Audio src={staticFile(`${assetDir}/${f}`)} startFrom={Math.round(((timing[i] && timing[i].trim) || 0) * fps)} />
          </Sequence>
        ))
      )}
      <Audio src={staticFile(`${assetDir}/musik.wav`)} volume={musicVolume} />
    </AbsoluteFill>
  );
};

// Durasi otomatis dari timeline
export const hitungMetadataKartun = ({ props }) => ({
  durationInFrames: Math.max(KARTUN_FPS, Math.ceil(hitungTimeline(props.spec, props.timing).total * KARTUN_FPS)),
  fps: KARTUN_FPS,
  width: 1080,
  height: 1920
});
