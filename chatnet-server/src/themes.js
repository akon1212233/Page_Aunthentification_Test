// src/themes.js — Manifest dinámico, soporta tweakcn real (.dark+hex) e interno (data-mode+HSL)
const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router  = express.Router();
const TWEAKCN = path.join(__dirname, '..', 'public', 'tweakcn');

let cache      = null;
let cacheMtime = 0;

// ── Extraer variables de un bloque por selector ───────────────────
// Busca "selector {" o "selector{" y extrae todas las --vars
function extractBlock(css, selector) {
  const vars = {};
  // Intentar con espacio y sin espacio antes de {
  let start = css.indexOf(selector + ' {');
  if (start < 0) start = css.indexOf(selector + '{');
  if (start < 0) return vars;

  const open  = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (open < 0 || close < 0) return vars;

  const body = css.slice(open + 1, close);
  const re = /--([a-zA-Z][\w-]*)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

// ── hex #rrggbb → "H S% L%" ──────────────────────────────────────
function hexToHslStr(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length !== 6) return null;
  const r = parseInt(hex.slice(0,2), 16) / 255;
  const g = parseInt(hex.slice(2,4), 16) / 255;
  const b = parseInt(hex.slice(4,6), 16) / 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// ── Normalizar cualquier valor color → "H S% L%" ─────────────────
function toHslStr(val) {
  if (!val) return null;
  val = val.trim();
  if (val.startsWith('#')) return hexToHslStr(val);
  if (val.startsWith('hsl(')) {
    const m = val.match(/hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/);
    return m ? `${m[1]} ${m[2]}% ${m[3]}%` : null;
  }
  // Ya está en formato "H S% L%"
  if (/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(val)) return val;
  return null;
}

// ── Parsear un archivo CSS ────────────────────────────────────────
function parseCss(filePath) {
  try {
    const css = fs.readFileSync(filePath, 'utf8');
    const id  = path.basename(filePath, '.css');

    // Nombre/tag desde comentario /* tweakcn — Nombre | tag */
    const cm   = css.match(/\/\*[^*]*tweakcn[^*]*[—\-]\s*([^|\n*]+?)(?:\|([^|\n*]+?))?\s*\*\//i);
    const name = cm ? cm[1].trim() : id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const tag  = cm?.[2]?.trim() || id;

    // Detectar formato del archivo
    const hasDarkClass = css.includes('.dark {') || css.includes('.dark{');
    const hasDataMode  = css.includes('[data-mode');

    // Extraer bloques
    const rootBlock     = extractBlock(css, ':root');
    const darkClsBlock  = extractBlock(css, '.dark');
    const dataModeBlock = extractBlock(css, '[data-mode="light"]');

    let darkVars, lightVars;

    if (hasDarkClass) {
      // tweakcn real: :root = LIGHT, .dark = DARK
      lightVars = rootBlock;
      darkVars  = Object.keys(darkClsBlock).length > 0 ? darkClsBlock : rootBlock;
    } else if (hasDataMode) {
      // formato interno: :root = DARK, [data-mode="light"] = LIGHT
      darkVars  = rootBlock;
      lightVars = Object.keys(dataModeBlock).length > 0 ? dataModeBlock : rootBlock;
    } else {
      // Sin variante oscura/clara → usar :root para ambos
      darkVars = lightVars = rootBlock;
    }

    const keys = ['background', 'primary', 'foreground'];
    const preview = {
      dark:  keys.map(k => toHslStr(darkVars[k])  || '0 0% 10%'),
      light: keys.map(k => toHslStr(lightVars[k]) || '0 0% 95%'),
    };

    return { id, name, tag, preview };

  } catch (err) {
    console.error(`[themes] Error en ${path.basename(filePath)}:`, err.message);
    return null;
  }
}

// ── Construir manifest ────────────────────────────────────────────
function buildManifest() {
  try {
    if (!fs.existsSync(TWEAKCN)) return { version: '2.0.0', themes: [] };

    const mtime = fs.statSync(TWEAKCN).mtimeMs;
    if (cache && mtime === cacheMtime) return cache;

    const themes = fs.readdirSync(TWEAKCN)
      .filter(f => f.endsWith('.css'))
      .sort()
      .map(f => parseCss(path.join(TWEAKCN, f)))
      .filter(Boolean);

    cache = { version: '2.0.0', generated: new Date().toISOString(), themes };
    cacheMtime = mtime;
    console.log(`[themes] ${themes.length} temas: ${themes.map(t => t.id).join(', ')}`);
    return cache;

  } catch (err) {
    console.error('[themes]', err.message);
    return { version: '2.0.0', themes: [] };
  }
}

router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  res.json(buildManifest());
});

router.post('/refresh', (req, res) => {
  cache = null; cacheMtime = 0;
  const m = buildManifest();
  res.json({ ok: true, count: m.themes.length, themes: m.themes.map(t => t.id) });
});

module.exports = router;