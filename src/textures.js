import * as THREE from 'three';

export const COLOR_PALETTE = {
  red: {
    main: '#ef233c',
    dark: '#9b0f22',
    glow: '#ff4d6d',
    three: 0xef233c,
    label: 'Red',
  },
  yellow: {
    main: '#ffb703',
    dark: '#c97a00',
    glow: '#ffd166',
    three: 0xffb703,
    label: 'Yellow',
  },
  green: {
    main: '#10b981',
    dark: '#047857',
    glow: '#34d399',
    three: 0x10b981,
    label: 'Green',
  },
  blue: {
    main: '#2563eb',
    dark: '#1d4ed8',
    glow: '#60a5fa',
    three: 0x2563eb,
    label: 'Blue',
  },
  wild: {
    main: '#181826',
    dark: '#0b0b14',
    glow: '#c084fc',
    three: 0xa855f7,
    label: 'Wild',
  },
};

const textureCache = new Map();
let backTextureCache = null;

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function getSymbolDisplay(value) {
  switch (value) {
    case 'skip':
      return '⊘';
    case 'reverse':
      return '⇄';
    case 'draw2':
      return '+2';
    case 'wild':
      return 'W';
    case 'wild4':
      return '+4';
    default:
      return String(value);
  }
}

function drawWildQuadOval(ctx, cx, cy, rx, ry) {
  const quads = [
    { start: Math.PI, end: 1.5 * Math.PI, color: COLOR_PALETTE.red.main },
    { start: 1.5 * Math.PI, end: 2 * Math.PI, color: COLOR_PALETTE.blue.main },
    { start: 0, end: 0.5 * Math.PI, color: COLOR_PALETTE.green.main },
    { start: 0.5 * Math.PI, end: Math.PI, color: COLOR_PALETTE.yellow.main },
  ];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.34);
  for (const q of quads) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.ellipse(0, 0, rx, ry, 0, q.start, q.end);
    ctx.closePath();
    ctx.fillStyle = q.color;
    ctx.fill();
  }
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMiniStackedCards(ctx, cx, cy) {
  const cards = [
    { dx: -44, dy: 20, rot: -0.22, color: COLOR_PALETTE.blue.main },
    { dx: -16, dy: -22, rot: -0.08, color: COLOR_PALETTE.red.main },
    { dx: 18, dy: 16, rot: 0.08, color: COLOR_PALETTE.yellow.main },
    { dx: 46, dy: -18, rot: 0.22, color: COLOR_PALETTE.green.main },
  ];
  for (const c of cards) {
    ctx.save();
    ctx.translate(cx + c.dx, cy + c.dy);
    ctx.rotate(c.rot);
    drawRoundedRect(ctx, -40, -58, 80, 116, 14);
    ctx.fillStyle = c.color;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
}

export function getCardFaceTexture(color, value) {
  const key = `${color}_${value}`;
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  const pal = COLOR_PALETTE[color] || COLOR_PALETTE.wild;
  const symbol = getSymbolDisplay(value);

  // Outer white border
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 768);

  // Inner colored card face with radial gradient
  drawRoundedRect(ctx, 24, 24, 464, 720, 42);
  const grad = ctx.createLinearGradient(0, 24, 512, 744);
  grad.addColorStop(0, pal.main);
  grad.addColorStop(1, pal.dark);
  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle geometric foil pattern
  ctx.save();
  drawRoundedRect(ctx, 24, 24, 464, 720, 42);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 14;
  for (let i = -400; i < 900; i += 52) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 420, 768);
    ctx.stroke();
  }
  ctx.restore();

  // Center tilted UNO oval
  if (color === 'wild') {
    drawWildQuadOval(ctx, 256, 384, 185, 265);
  } else {
    ctx.save();
    ctx.translate(256, 384);
    ctx.rotate(-0.34);
    ctx.beginPath();
    ctx.ellipse(0, 0, 185, 265, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = pal.main;
    ctx.stroke();
    ctx.restore();
  }

  // Center symbol or special graphic
  if (value === 'wild4') {
    drawMiniStackedCards(ctx, 256, 360);
    ctx.save();
    ctx.font = '900 130px "Trebuchet MS", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111827';
    ctx.fillText('+4', 262, 476);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('+4', 256, 470);
    ctx.fillStyle = '#fde047';
    ctx.fillText('+4', 256, 470);
    ctx.restore();
  } else if (value === 'wild') {
    ctx.save();
    ctx.font = '900 120px "Trebuchet MS", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('WILD', 262, 392);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('WILD', 256, 384);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('WILD', 256, 384);
    ctx.restore();
  } else {
    ctx.save();
    const isTwoChar = symbol.length > 1;
    ctx.font = `900 ${isTwoChar ? 210 : 265}px "Trebuchet MS", "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Extruded drop shadow
    ctx.fillStyle = '#0f172a';
    ctx.fillText(symbol, 268, 398);

    // Main colored glyph
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(symbol, 256, 384);
    ctx.fillStyle = pal.main;
    ctx.fillText(symbol, 256, 384);

    // Underline on 6 and 9
    if (value === '6' || value === '9') {
      ctx.fillStyle = pal.main;
      ctx.fillRect(196, 515, 120, 16);
    }
    ctx.restore();
  }

  // Top-left corner pip
  ctx.save();
  ctx.font = '900 78px "Trebuchet MS", "Arial Black", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(symbol, 54, 52);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(symbol, 50, 48);
  ctx.restore();

  // Bottom-right corner pip (rotated 180 deg)
  ctx.save();
  ctx.translate(512 - 50, 768 - 48);
  ctx.rotate(Math.PI);
  ctx.font = '900 78px "Trebuchet MS", "Arial Black", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(symbol, 4, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(symbol, 0, 0);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

export function getCardFaceDataUrl(color, value) {
  const tex = getCardFaceTexture(color, value);
  return tex.image.toDataURL('image/png');
}

export function getCardBackTexture() {
  if (backTextureCache) return backTextureCache;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');

  // Outer border
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 512, 768);

  // Deep obsidian inner background
  drawRoundedRect(ctx, 22, 22, 468, 724, 42);
  const bgGrad = ctx.createLinearGradient(0, 0, 512, 768);
  bgGrad.addColorStop(0, '#111827');
  bgGrad.addColorStop(0.5, '#090d16');
  bgGrad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Gold foil border inset
  drawRoundedRect(ctx, 38, 38, 436, 692, 32);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
  ctx.stroke();

  // Scarlet tilted oval
  ctx.save();
  ctx.translate(256, 384);
  ctx.rotate(-0.36);
  ctx.beginPath();
  ctx.ellipse(0, 0, 185, 270, 0, 0, Math.PI * 2);
  const ovalGrad = ctx.createRadialGradient(-30, -40, 20, 0, 0, 270);
  ovalGrad.addColorStop(0, '#ff4d6d');
  ovalGrad.addColorStop(0.6, '#e11d48');
  ovalGrad.addColorStop(1, '#881337');
  ctx.fillStyle = ovalGrad;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#fde047';
  ctx.stroke();

  // Embossed 3D UNO text
  ctx.rotate(0.18);
  ctx.font = '900 144px "Trebuchet MS", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#090d16';
  ctx.fillText('UNO', 12, 14);
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#111827';
  ctx.strokeText('UNO', 0, 0);

  const textGrad = ctx.createLinearGradient(0, -70, 0, 70);
  textGrad.addColorStop(0, '#fef08a');
  textGrad.addColorStop(0.5, '#facc15');
  textGrad.addColorStop(1, '#ea580c');
  ctx.fillStyle = textGrad;
  ctx.fillText('UNO', 0, 0);
  ctx.restore();

  backTextureCache = new THREE.CanvasTexture(canvas);
  backTextureCache.colorSpace = THREE.SRGBColorSpace;
  backTextureCache.anisotropy = 8;
  return backTextureCache;
}

export function createTableFeltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Deep royal sapphire-indigo cyber arena felt matching the neon mockup
  const grad = ctx.createRadialGradient(512, 512, 40, 512, 512, 520);
  grad.addColorStop(0, '#13316b');
  grad.addColorStop(0.5, '#0b1c45');
  grad.addColorStop(0.85, '#07112b');
  grad.addColorStop(1, '#040818');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  // Concentric neon cyan & violet arena rings
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.24)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(512, 512, 420, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(129, 140, 248, 0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(512, 512, 310, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(512, 512, 195, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
