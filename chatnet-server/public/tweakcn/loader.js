/**
 * ThemeLoader — tweakcn lazy theme system
 *
 * Estructura esperada:
 *   /tweakcn/manifest.json   → lista de temas disponibles
 *   /tweakcn/{id}.css        → variables CSS de cada tema
 *
 * Flujo:
 *   1. Al iniciar, carga manifest.json (una sola vez)
 *   2. Lee la preferencia guardada en localStorage
 *   3. Solo descarga el CSS del tema elegido (no todos)
 *   4. Inyecta el CSS en un <style id="tweakcn-active">
 *   5. Guarda el CSS descargado en memoria (cache) para no re-descargarlo
 *      si el usuario cambia y vuelve al mismo tema en la misma sesión
 */

const ThemeLoader = (() => {

  // ─── Configuración ───────────────────────────────────────────────
  const BASE_PATH    = './tweakcn';         // carpeta de temas CSS
  const MANIFEST_URL = '/api/themes';       // endpoint dinámico del servidor
  const STORAGE_KEY  = 'cn-theme';          // clave localStorage para el tema
  const MODE_KEY     = 'cn-mode';           // clave localStorage para el modo
  const STYLE_ID     = 'tweakcn-active';    // id del <style> inyectado
  const DEFAULT_ID   = 'default';           // tema de fallback

  // ─── Estado interno ───────────────────────────────────────────────
  let manifest   = null;          // { version, themes: [...] }
  let cssCache   = {};            // { [themeId]: cssText }  — cache en memoria
  let currentId  = null;
  let currentMode = null;
  let listeners  = [];            // callbacks registrados con .onChange()

  // ─── Helpers ──────────────────────────────────────────────────────

  /** Devuelve o crea el <style> donde se inyecta el tema activo */
  function getStyleTag() {
    let tag = document.getElementById(STYLE_ID);
    if (!tag) {
      tag = document.createElement('style');
      tag.id = STYLE_ID;
      // Insertar ANTES de cualquier otro <style> para que el CSS
      // de la app pueda sobreescribir variables si hace falta
      const first = document.head.querySelector('style, link[rel="stylesheet"]');
      first ? document.head.insertBefore(tag, first) : document.head.appendChild(tag);
    }
    return tag;
  }

  /** Resuelve el modo real considerando 'auto' */
  function resolveMode(mode) {
    if (mode === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode || 'dark';
  }

  /** Aplica el modo al <html> según el formato del tema activo.
   *  - formato 'dark-class': añade/quita clase 'dark' en <html>
   *  - formato 'data-mode':  usa atributo data-mode="dark|light"
   */
  function applyModeAttr(mode) {
    const resolved = resolveMode(mode);
    const fmt = manifest?.themes.find(t => t.id === currentId)?.format || 'dark-class';

    if (fmt === 'dark-class') {
      // Clase dark en <html> (formato tweakcn real)
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      document.documentElement.removeAttribute('data-mode');
    } else {
      // Atributo data-mode (formato interno)
      document.documentElement.setAttribute('data-mode', resolved);
      document.documentElement.classList.remove('dark');
    }
  }

  /** Notifica a todos los listeners */
  function notify(themeId, mode) {
    const themeData = manifest?.themes.find(t => t.id === themeId) || null;
    listeners.forEach(fn => fn({ id: themeId, mode, resolved: resolveMode(mode), theme: themeData }));
  }

  // ─── Carga del manifest ───────────────────────────────────────────

  async function loadManifest() {
    if (manifest) return manifest;
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error(`/api/themes → HTTP ${res.status}`);
      manifest = await res.json();
      console.log(`[ThemeLoader] ${manifest.themes.length} temas detectados en /tweakcn`);
      return manifest;
    } catch (err) {
      console.error('[ThemeLoader] Error cargando manifest:', err);
      manifest = { version: 'fallback', themes: [] };
      return manifest;
    }
  }

  // ─── Carga de CSS ────────────────────────────────────────────────

  async function fetchCSS(themeId) {
    // 1. Cache en memoria (misma sesión)
    if (cssCache[themeId]) {
      console.log(`[ThemeLoader] "${themeId}" desde cache de memoria`);
      return cssCache[themeId];
    }

    // 2. Descargar desde /tweakcn/{id}.css
    try {
      const url = `${BASE_PATH}/${themeId}.css`;
      console.log(`[ThemeLoader] Descargando "${themeId}" → ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const css = await res.text();
      cssCache[themeId] = css;   // guardar en cache de memoria
      return css;
    } catch (err) {
      console.warn(`[ThemeLoader] No se pudo cargar "${themeId}":`, err);
      return null;
    }
  }

  // ─── API pública ──────────────────────────────────────────────────

  /**
   * Inicializa el loader.
   * - Carga el manifest
   * - Aplica el tema guardado en localStorage (o el default)
   * Llamar una vez al arrancar la app.
   *
   * @returns {Promise<{themes, current, mode}>}
   */
  async function init() {
    await loadManifest();

    const savedTheme = localStorage.getItem(STORAGE_KEY) || DEFAULT_ID;
    const savedMode  = localStorage.getItem(MODE_KEY)    || 'dark';

    await apply(savedTheme, savedMode);

    // Escuchar cambios del sistema si el modo es 'auto'
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentMode === 'auto') applyModeAttr('auto');
    });

    return {
      themes:  manifest.themes,
      current: currentId,
      mode:    currentMode,
    };
  }

  /**
   * Aplica un tema (descargándolo si no está en cache).
   *
   * @param {string} themeId  — id del tema (ej: 't3-chat')
   * @param {string} [mode]   — 'dark' | 'light' | 'auto'  (opcional, mantiene el actual)
   * @returns {Promise<boolean>} — true si se aplicó correctamente
   */
  async function apply(themeId, mode) {
    // Validar que el tema existe en el manifest
    const exists = !manifest || manifest.themes.length === 0 ||
                   manifest.themes.some(t => t.id === themeId);

    const targetId   = exists ? themeId : DEFAULT_ID;
    const targetMode = mode !== undefined ? mode : (currentMode || 'dark');

    // Mostrar estado de carga (útil para UIs que quieran mostrarlo)
    document.documentElement.setAttribute('data-theme-loading', 'true');

    const css = await fetchCSS(targetId);

    if (!css) {
      console.error(`[ThemeLoader] Fallback a "${DEFAULT_ID}"`);
      document.documentElement.removeAttribute('data-theme-loading');
      if (targetId !== DEFAULT_ID) return apply(DEFAULT_ID, targetMode);
      return false;
    }

    // Inyectar CSS
    getStyleTag().textContent = css;

    // Aplicar atributos al <html>
    document.documentElement.setAttribute('data-theme', targetId);
    applyModeAttr(targetMode);
    document.documentElement.removeAttribute('data-theme-loading');

    // Persistir en localStorage
    localStorage.setItem(STORAGE_KEY, targetId);
    localStorage.setItem(MODE_KEY, targetMode);

    currentId   = targetId;
    currentMode = targetMode;

    notify(targetId, targetMode);
    return true;
  }

  /**
   * Cambia solo el modo (dark / light / auto) sin re-descargar el CSS.
   *
   * @param {'dark'|'light'|'auto'} mode
   */
  function setMode(mode) {
    currentMode = mode;
    localStorage.setItem(MODE_KEY, mode);
    applyModeAttr(mode);
    notify(currentId, mode);
  }

  /**
   * Devuelve la lista de temas del manifest.
   * Si aún no se cargó, retorna [].
   *
   * @returns {Array}
   */
  function getThemes() {
    return manifest?.themes || [];
  }

  /**
   * Devuelve el estado actual.
   *
   * @returns {{ id: string, mode: string, resolved: string }}
   */
  function getCurrent() {
    return {
      id:       currentId,
      mode:     currentMode,
      resolved: resolveMode(currentMode),
    };
  }

  /**
   * Precarga un tema en cache sin aplicarlo.
   * Útil para hacer prefetch al hacer hover en la opción del panel.
   *
   * @param {string} themeId
   */
  async function prefetch(themeId) {
    if (!cssCache[themeId]) {
      await fetchCSS(themeId);
    }
  }

  /**
   * Registra un callback que se ejecuta cada vez que cambia el tema o el modo.
   *
   * @param {Function} fn — recibe { id, mode, resolved, theme }
   * @returns {Function} unsubscribe — llama para dejar de escuchar
   */
  function onChange(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter(l => l !== fn); };
  }

  /**
   * Devuelve cuántos temas están en cache de memoria.
   */
  function cacheStats() {
    const ids = Object.keys(cssCache);
    return {
      count: ids.length,
      ids,
      bytes: ids.reduce((acc, id) => acc + (cssCache[id]?.length || 0), 0),
    };
  }

  /**
   * Fuerza recargar el manifest desde /api/themes.
   * Útil tras añadir un CSS nuevo a la carpeta tweakcn.
   * @returns {Promise<Array>} lista actualizada de temas
   */
  async function refresh() {
    manifest = null;
    await loadManifest();
    notify(currentId, currentMode);
    return manifest.themes;
  }

  // ─── Exponer API ──────────────────────────────────────────────────
  return { init, apply, setMode, getThemes, getCurrent, prefetch, onChange, cacheStats, refresh };

})();

// Exportar para uso con módulos ES o directo en browser
if (typeof module !== 'undefined') module.exports = ThemeLoader;
