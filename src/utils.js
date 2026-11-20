// Utilidades compartidas: límites de tiempo para llamadas a servicios externos.
// Sin ellos, un proveedor que no responde deja la petición colgada hasta que Render la corta.

/** fetch con tiempo máximo (ms). Si se agota, lanza un error con name === 'TimeoutError'. */
export const fetchConTiempo = (url, opciones = {}, ms = 10_000) =>
  fetch(url, { ...opciones, signal: AbortSignal.timeout(ms) });

/** Espera una promesa como máximo `ms`. No cancela la tarea original (sirve para SDKs sin soporte de timeout). */
export function conTiempo(promesa, ms, etiqueta = 'operación') {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(Object.assign(new Error(`${etiqueta}: tiempo agotado (${ms} ms)`), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

export const esTimeout = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';
