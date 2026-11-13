/**
 * Template video konsep Remotion (1080x1920, 30 fps)
 * - ProductPromo : video dari foto produk (tanpa suara, musik dipilih saat upload TikTok)
 * - VideoOverlay : teks hook / keunggulan / harga di atas video yang sudah ada (suara asli tetap)
 */
import React from 'react';
import { Composition } from 'remotion';
import { ProductPromo } from './ProductPromo';
import { VideoOverlay } from './VideoOverlay';
import { Edu3D } from './Edu3D';
import { Kartun3D, hitungMetadataKartun } from './Kartun3D';

export const FPS = 30;

const defaultProps = {
  images: [],
  videoSrc: '',
  videoDurationSec: 0,
  durationSec: 15,
  hook: 'Hook 3 detik pertama',
  points: ['Keunggulan pertama', 'Keunggulan kedua', 'Keunggulan ketiga'],
  price: 'Rp99.000',
  cta: 'Cek keranjang kuning',
  accent: '#35b29f'
};

export const RemotionRoot = () => (
  <>
    <Composition
      id="ProductPromo"
      component={ProductPromo}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={15 * FPS}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round(Math.min(30, Math.max(8, Number(props.durationSec) || 15)) * FPS)
      })}
    />
    <Composition
      id="VideoOverlay"
      component={VideoOverlay}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={10 * FPS}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(3 * FPS, Math.round((Number(props.videoDurationSec) || 10) * FPS))
      })}
    />
    <Composition
      id="Edu3D"
      component={Edu3D}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={30 * FPS}
      defaultProps={{ segments: [], label: '' }}
      calculateMetadata={({ props }) => ({
        // Sama persis dengan pembulatan per adegan di Edu3D
        durationInFrames: Math.max(FPS, (props.segments || []).reduce((sum, s) => sum + Math.max(FPS, Math.round((Number(s.durSec) || 1) * FPS)), 0))
      })}
    />
    <Composition
      id="Kartun3D"
      component={Kartun3D}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={10 * FPS}
      defaultProps={{ spec: { judul: '', scenes: [] }, timing: [], assetDir: '' }}
      calculateMetadata={hitungMetadataKartun}
    />
  </>
);
