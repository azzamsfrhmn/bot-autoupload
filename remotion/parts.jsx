/**
 * Elemen teks bersama untuk kedua template, gaya caption TikTok (huruf tebal putih + outline hitam).
 * Area aman TikTok: hindari 18% bawah (caption/tombol) dan 14% kanan (ikon like/komentar).
 */
import React from 'react';
import { interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

// Berkas lokal disalin aplikasi ke folder job bundle → pakai staticFile; URL/data URL dipakai apa adanya
export const resolveSrc = (src) => (!src || /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src));

export const FONT = '"Segoe UI Black", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export function usePop(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 11, stiffness: 180, mass: 0.6 } });
}

// Outline hitam dari bayangan 16 arah (-webkit-text-stroke tidak tergambar konsisten di render)
const outlineShadow = (w) => {
  const dirs = [];
  for (let a = 0; a < 16; a++) {
    const rad = (a / 16) * Math.PI * 2;
    dirs.push(`${(Math.cos(rad) * w).toFixed(1)}px ${(Math.sin(rad) * w).toFixed(1)}px 0 #000`);
  }
  return [...dirs, '0 10px 24px rgba(0,0,0,0.5)'].join(', ');
};

// Teks caption TikTok: putih tebal dengan outline hitam tebal
const captionStyle = (size) => ({
  fontFamily: FONT,
  fontWeight: 900,
  fontSize: size,
  lineHeight: 1.12,
  color: '#fff',
  textAlign: 'center',
  textShadow: outlineShadow(Math.max(4, Math.round(size * 0.07))),
  letterSpacing: -0.5
});

// Kata kunci terakhir disorot kuning agar mata langsung tertuju
function HighlightLast({ text }) {
  const words = String(text || '').trim().split(/\s+/);
  if (words.length < 3) return <>{text}</>;
  // Kata terakhir terlalu pendek (mis. "kg") → sorot dua kata terakhir
  const take = words[words.length - 1].length < 4 ? 2 : 1;
  const tail = words.splice(words.length - take, take).join(' ');
  return <>{words.join(' ')} <span style={{ color: '#ffd84a' }}>{tail}</span></>;
}

// Hook pembuka (3 detik pertama), sepertiga atas layar
export const HookText = ({ text }) => {
  const p = usePop(3);
  return (
    <div style={{
      position: 'absolute', left: 60, right: 60, top: 300,
      transform: `scale(${interpolate(p, [0, 1], [0.6, 1])})`, opacity: Math.min(1, p * 1.5)
    }}>
      <div style={captionStyle(96)}><HighlightLast text={text} /></div>
    </div>
  );
};

// Satu keunggulan: caption besar di bawah tengah (di atas area tombol TikTok)
export const PointCard = ({ text }) => {
  const p = usePop(0);
  return (
    <div style={{
      position: 'absolute', left: 60, right: 140, top: 1180,
      transform: `translateY(${(1 - p) * 40}px) scale(${interpolate(p, [0, 1], [0.8, 1])})`, opacity: Math.min(1, p * 1.5)
    }}>
      <div style={captionStyle(78)}><HighlightLast text={text} /></div>
    </div>
  );
};

// Penutup: stiker harga miring + ajakan dengan panah ke kiri bawah (posisi keranjang kuning)
export const PriceCta = ({ price, cta, accent }) => {
  const frame = useCurrentFrame();
  const p = usePop(0);
  const pulse = 1 + 0.04 * Math.sin(frame / 4);
  const arrowBob = 10 * Math.sin(frame / 5);
  return (
    <>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 860, display: 'flex', flexDirection: 'column', alignItems: 'center',
        transform: `scale(${interpolate(p, [0, 1], [0.4, 1])}) rotate(-4deg)`, opacity: Math.min(1, p * 1.5)
      }}>
        <div style={{ ...captionStyle(64), marginBottom: 18 }}>Cuma</div>
        {price ? (
          <div style={{
            fontFamily: FONT, fontWeight: 900, fontSize: 150, color: '#1a1206', background: '#ffd84a',
            padding: '6px 44px 14px', borderRadius: 30, letterSpacing: -3,
            boxShadow: '0 18px 0 rgba(0,0,0,0.35)', transform: `scale(${pulse})`
          }}>{price}</div>
        ) : null}
      </div>
      <div style={{
        position: 'absolute', left: 60, right: 140, top: 1180, opacity: Math.min(1, p * 1.5)
      }}>
        <div style={captionStyle(72)}>{cta}</div>
      </div>
      {/* Panah menunjuk keranjang kuning (kiri bawah) */}
      <div style={{
        position: 'absolute', left: 120, top: 1330 + arrowBob, width: 0, height: 0,
        borderLeft: '46px solid transparent', borderRight: '46px solid transparent',
        borderTop: `70px solid ${accent || '#35b29f'}`, filter: 'drop-shadow(0 6px 0 rgba(0,0,0,0.5))',
        opacity: Math.min(1, p * 1.5)
      }} />
    </>
  );
};

// Gradasi tipis atas & bawah agar caption tetap terbaca tanpa menggelapkan produk
export const Shade = () => (
  <div style={{
    position: 'absolute', inset: 0,
    background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.45) 100%)'
  }} />
);
