// Límites de uso y código de acceso. Gemini y ElevenLabs cuestan dinero y la cuota de YouTube es limitada:
// sin esto, cualquiera que encuentre la URL podría gastarlos.

import crypto from 'crypto';

/**
 * Limitador de ventana deslizante: como mucho `max` usos cada `ventanaMs` por clave.
 * `consumir(clave)` devuelve true si se permite (y cuenta el uso) o false si se supera el límite.
 */
export function crearLimitador(max, ventanaMs, reloj = () => Date.now()) {
  const usos = new Map(); // clave -> [timestamps]
  const limpiar = () => {
    const ahora = reloj();
    for (const [k, v] of usos) if (!v.some(t => ahora - t < ventanaMs)) usos.delete(k);
  };
  const temporizador = setInterval(limpiar, 10 * 60_000);
  temporizador.unref?.();
  return {
    consumir(clave) {
      const ahora = reloj();
      const recientes = (usos.get(clave) || []).filter(t => ahora - t < ventanaMs);
      if (recientes.length >= max) { usos.set(clave, recientes); return false; }
      recientes.push(ahora);
      usos.set(clave, recientes);
      return true;
    },
    get tamano() { return usos.size; },
    limpiar,
  };
}

/** Comparación del código de acceso en tiempo constante (no revela cuántos caracteres acertó). */
export function codigoValido(recibido, esperado) {
  if (!esperado) return true; // sin ACCESS_CODE configurado, la app es abierta
  const h = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
  return crypto.timingSafeEqual(h(recibido), h(esperado));
}

/** Middleware de Express: exige la cabecera `x-codigo` si hay ACCESS_CODE. */
export function exigirCodigo(esperado) {
  return (req, res, next) => {
    if (codigoValido(req.get('x-codigo'), esperado)) return next();
    res.status(401).json({ success: false, codigo: 'CODIGO', error: 'Código de acceso incorrecto' });
  };
}
