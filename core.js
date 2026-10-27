/*!
 * core.js — Plataforma de examen: lógica compartida entre la página del
 * estudiante (index.html) y el panel docente (admin.html).
 *
 * No depende de ninguna librería. Se comunica con Firebase Realtime Database
 * por su API REST (sin conexión permanente) y con Firebase Authentication
 * solo para el docente.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Core = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Sin I, L, O, 0, 1 para evitar confusiones al dictar o leer el código.
  var ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var LETRAS = 'abcdef';
  // Margen que las reglas de Firebase dan después del tiempo oficial (ms).
  // Debe coincidir con el número que aparece en reglas-firebase.json.
  var GRACIA_MS = 90000;

  /* ------------------------------------------------------------------ */
  /* Utilidades básicas                                                  */
  /* ------------------------------------------------------------------ */

  function criptografia() {
    var c = (typeof globalThis !== 'undefined') ? globalThis.crypto : undefined;
    if (!c || !c.subtle) {
      throw new Error('Este navegador no permite las funciones de seguridad necesarias. Usa Chrome, Edge, Firefox o Safari actualizados y abre la página con https.');
    }
    return c;
  }

  function sha256Hex(texto) {
    var datos = new TextEncoder().encode(String(texto));
    return criptografia().subtle.digest('SHA-256', datos).then(function (huella) {
      return Array.prototype.map.call(new Uint8Array(huella), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function bytesAleatorios(n) {
    var a = new Uint8Array(n);
    criptografia().getRandomValues(a);
    return a;
  }

  function tokenAleatorio() {
    return Array.prototype.map.call(bytesAleatorios(16), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  function escaparHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------ */
  /* Código de acceso, documento e identificadores                       */
  /* ------------------------------------------------------------------ */

  function normalizarCodigo(texto) {
    return String(texto == null ? '' : texto).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // Formatea mientras se escribe: ABCD-EFGH
  function formatearCodigoEntrada(texto) {
    var n = normalizarCodigo(texto).slice(0, 8);
    return n.length > 4 ? n.slice(0, 4) + '-' + n.slice(4) : n;
  }

  function codigoValido(texto) {
    var n = normalizarCodigo(texto);
    if (n.length !== 8) return false;
    for (var i = 0; i < n.length; i++) if (ALFABETO.indexOf(n[i]) < 0) return false;
    return true;
  }

  // 8 caracteres de un alfabeto de 31 => ~39,6 bits. Se usa muestreo con
  // rechazo (248 = 31 * 8) para que ningún carácter sea más probable que otro.
  function generarCodigo() {
    var salida = '';
    while (salida.length < 8) {
      var bytes = bytesAleatorios(16);
      for (var i = 0; i < bytes.length && salida.length < 8; i++) {
        if (bytes[i] < 248) salida += ALFABETO[bytes[i] % 31];
      }
    }
    return salida.slice(0, 4) + '-' + salida.slice(4);
  }

  function normalizarDocumento(texto) {
    return String(texto == null ? '' : texto).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // Valida lo que escribe el estudiante al ingresar. Devuelve mensajes por campo.
  function validarEstudiante(datos, universidades) {
    var errores = {};
    var nombre = String(datos && datos.nombre != null ? datos.nombre : '').trim().replace(/\s+/g, ' ');
    if (nombre.length < 5 || !/\s/.test(nombre) || nombre.length > 120) {
      errores.nombre = 'Escribe tu nombre y apellido completos.';
    }
    var documento = normalizarDocumento(datos && datos.documento);
    if (documento.length < 5 || documento.length > 20) {
      errores.documento = 'Revisa tu número de documento (entre 5 y 20 caracteres).';
    }
    var universidad = datos && datos.universidad;
    if (!universidad || (universidades || []).indexOf(universidad) < 0) {
      errores.universidad = 'Selecciona tu universidad.';
    }
    return {
      ok: Object.keys(errores).length === 0,
      errores: errores,
      nombre: nombre,
      documento: documento,
      universidad: universidad
    };
  }

  // Identificador de la sesión en la base de datos: nadie puede calcularlo
  // sin conocer el código, y la base de datos no permite listar las sesiones.
  function hashCodigo(codigo) {
    return sha256Hex('sesion|' + normalizarCodigo(codigo));
  }

  // Un intento por documento y sesión.
  function claveEstudiante(h, documento) {
    return sha256Hex('estudiante|' + h + '|' + normalizarDocumento(documento));
  }

  // Comprobante corto que el estudiante ve al enviar y el docente ve en la tabla.
  // Se deriva del token con un hash para no exponer el token.
  function comprobante(token) {
    return sha256Hex('comprobante|' + token).then(function (h) {
      var c = h.slice(0, 8).toUpperCase();
      return c.slice(0, 4) + '-' + c.slice(4);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Orden aleatorio por estudiante                                      */
  /* ------------------------------------------------------------------ */

  function mulberry32(semilla) {
    var a = semilla >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function semillaDesdeHex(hex) {
    return parseInt(String(hex).slice(0, 8), 16) >>> 0;
  }

  function barajar(lista, azar) {
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(azar() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Devuelve las preguntas en el orden que verá ESTE estudiante. El orden es
  // el mismo cada vez que entra (depende de su clave), así que recargar la
  // página no cambia nada. Las respuestas se guardan con la letra ORIGINAL de
  // la opción, de modo que calificar no depende del orden mostrado.
  function prepararExamen(publico, clave) {
    var azar = mulberry32(semillaDesdeHex(clave));
    var preguntas = barajar(listaDe(publico.preguntas), azar);
    return preguntas.map(function (p) {
      var opciones = listaDe(p.opciones).map(function (texto, i) {
        return { id: LETRAS[i], texto: texto };
      });
      return {
        id: p.id,
        area: p.area || '',
        enunciado: p.enunciado,
        opciones: p.fijarOpciones ? opciones : barajar(opciones, azar)
      };
    });
  }

  // Firebase puede devolver listas como objetos {0:..,1:..}; esto las normaliza.
  function listaDe(x) {
    if (Array.isArray(x)) return x.filter(function (v) { return v != null; });
    if (x && typeof x === 'object') {
      return Object.keys(x).sort(function (a, b) { return Number(a) - Number(b); })
        .map(function (k) { return x[k]; });
    }
    return [];
  }

  /* ------------------------------------------------------------------ */
  /* Validación del examen (archivo JSON que sube el docente)            */
  /* ------------------------------------------------------------------ */

  function validarExamen(obj) {
    var errores = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, errores: ['El archivo no tiene el formato esperado (debe ser un objeto JSON).'] };
    }
    if (!Array.isArray(obj.preguntas) || obj.preguntas.length === 0) {
      return { ok: false, errores: ['Falta la lista "preguntas" o está vacía.'] };
    }
    if (obj.preguntas.length > 200) errores.push('Hay más de 200 preguntas.');

    var vistos = {};
    var preguntas = obj.preguntas.map(function (p, i) {
      var n = i + 1;
      if (!p || typeof p !== 'object') { errores.push('Pregunta ' + n + ': formato inválido.'); return null; }
      var id = p.id != null ? String(p.id) : 'q' + n;
      if (!/^q[0-9]{1,3}$/.test(id)) errores.push('Pregunta ' + n + ': el id "' + id + '" debe ser como q1, q2…');
      if (vistos[id]) errores.push('Pregunta ' + n + ': el id "' + id + '" está repetido.');
      vistos[id] = true;

      var enun = typeof p.enunciado === 'string' ? p.enunciado.trim() : '';
      if (enun.length < 5) errores.push('Pregunta ' + n + ': falta el enunciado.');
      if (enun.length > 3000) errores.push('Pregunta ' + n + ': el enunciado es demasiado largo.');

      var ops = Array.isArray(p.opciones) ? p.opciones.map(function (o) { return typeof o === 'string' ? o.trim() : ''; }) : [];
      if (ops.length < 2 || ops.length > 6) errores.push('Pregunta ' + n + ': debe tener entre 2 y 6 opciones.');
      if (ops.some(function (o) { return !o; })) errores.push('Pregunta ' + n + ': hay opciones vacías.');
      if (ops.some(function (o) { return o.length > 600; })) errores.push('Pregunta ' + n + ': una opción es demasiado larga.');

      var correcta = typeof p.correcta === 'string' ? p.correcta.trim().toLowerCase() : '';
      var idx = LETRAS.indexOf(correcta);
      if (correcta.length !== 1 || idx < 0 || idx >= ops.length) {
        errores.push('Pregunta ' + n + ': "correcta" debe ser una letra entre a y ' + LETRAS[Math.max(ops.length - 1, 0)] + '.');
      }
      return {
        id: id,
        area: typeof p.area === 'string' ? p.area.trim() : '',
        enunciado: enun,
        opciones: ops,
        correcta: correcta,
        justificacion: typeof p.justificacion === 'string' ? p.justificacion.trim() : '',
        fijarOpciones: p.fijarOpciones === true
      };
    });

    var dur = obj.duracionMin == null ? 40 : Number(obj.duracionMin);
    if (!(dur >= 1 && dur <= 600)) errores.push('"duracionMin" debe ser un número entre 1 y 600.');

    var titulo = typeof obj.titulo === 'string' && obj.titulo.trim() ? obj.titulo.trim() : 'Examen';
    if (titulo.length > 150) errores.push('El título es demasiado largo.');

    if (errores.length) return { ok: false, errores: errores };
    return { ok: true, errores: [], examen: { titulo: titulo, duracionMin: dur, preguntas: preguntas } };
  }

  // Separa lo que verán los estudiantes (sin respuestas) de lo que solo ve el docente.
  function separarExamen(examen) {
    var publico = {
      titulo: examen.titulo,
      preguntas: examen.preguntas.map(function (p) {
        var q = { id: p.id, enunciado: p.enunciado, opciones: p.opciones.slice() };
        if (p.area) q.area = p.area;
        if (p.fijarOpciones) q.fijarOpciones = true;
        return q;
      })
    };
    var correctas = {};
    examen.preguntas.forEach(function (p) { correctas[p.id] = p.correcta; });
    return { publico: publico, correctas: correctas, completo: examen };
  }

  /* ------------------------------------------------------------------ */
  /* Calificación y estadísticas (solo las usa el panel docente)         */
  /* ------------------------------------------------------------------ */

  function calificar(respuestas, correctas) {
    var ids = Object.keys(correctas || {});
    var aciertos = 0, respondidas = 0;
    ids.forEach(function (id) {
      var r = respuestas ? respuestas[id] : null;
      if (typeof r === 'string' && r) {
        respondidas++;
        if (r.toLowerCase() === String(correctas[id]).toLowerCase()) aciertos++;
      }
    });
    return { aciertos: aciertos, respondidas: respondidas, total: ids.length };
  }

  // Nota lineal de 0,0 a 5,0 con un decimal. Aritmética entera para no
  // arrastrar errores de coma flotante en los .25 y .75.
  function notaLineal(aciertos, total) {
    if (!total) return 0;
    return Math.round(aciertos * 50 / total) / 10;
  }

  function promedio(lista) {
    if (!lista.length) return 0;
    var s = 0;
    for (var i = 0; i < lista.length; i++) s += lista[i];
    return s / lista.length;
  }

  // filas: [{universidad, enviado, aciertos, total, nota, pct}]
  function resumenPorUniversidad(filas, umbralPct) {
    var grupos = {};
    filas.forEach(function (f) {
      var g = grupos[f.universidad] || (grupos[f.universidad] = []);
      g.push(f);
    });
    return Object.keys(grupos).sort().map(function (u) {
      var g = grupos[u];
      return {
        universidad: u,
        n: g.length,
        enviados: g.filter(function (f) { return f.enviado; }).length,
        promedioNota: Math.round(promedio(g.map(function (f) { return f.nota; })) * 10) / 10,
        promedioPct: Math.round(promedio(g.map(function (f) { return f.pct; }))),
        aprobados: g.filter(function (f) { return f.pct >= umbralPct; }).length
      };
    });
  }

  // intentos: lista de mapas de respuestas {q1:'a', ...}
  function analisisPreguntas(examenCompleto, listaRespuestas) {
    return examenCompleto.preguntas.map(function (p) {
      var dist = {};
      LETRAS.slice(0, p.opciones.length).split('').forEach(function (l) { dist[l] = 0; });
      var n = 0, ok = 0;
      listaRespuestas.forEach(function (r) {
        var v = r && r[p.id];
        if (typeof v === 'string' && v in dist) { dist[v]++; n++; if (v === p.correcta) ok++; }
      });
      var masElegidaIncorrecta = null, maxInc = 0;
      Object.keys(dist).forEach(function (l) {
        if (l !== p.correcta && dist[l] > maxInc) { maxInc = dist[l]; masElegidaIncorrecta = l; }
      });
      var pct = n ? Math.round(ok * 100 / n) : null;
      return {
        id: p.id, area: p.area, enunciado: p.enunciado, correcta: p.correcta,
        n: n, aciertos: ok, pct: pct, distribucion: dist,
        masElegidaIncorrecta: masElegidaIncorrecta,
        alerta: pct === null ? null : (pct > 90 ? 'muy-facil' : (pct < 30 ? 'dificil' : null))
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /* CSV (punto y coma y coma decimal: es lo que espera Excel en español) */
  /* ------------------------------------------------------------------ */

  function celdaCSV(v) {
    var s = v == null ? '' : String(v);
    // Evita que Excel interprete texto como fórmula.
    if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s.replace(',', '.')))) s = "'" + s;
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function aCSV(filas) {
    return filas.map(function (fila) { return fila.map(celdaCSV).join(';'); }).join('\r\n');
  }

  function decimalES(n) {
    return String(n).replace('.', ',');
  }

  /* ------------------------------------------------------------------ */
  /* Fechas                                                              */
  /* ------------------------------------------------------------------ */

  function dos(n) { return String(n).padStart(2, '0'); }

  function formatoFechaHora(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + ' ' +
      dos(d.getHours()) + ':' + dos(d.getMinutes()) + ':' + dos(d.getSeconds());
  }

  function formatoMinSeg(segundos) {
    var s = Math.max(0, Math.floor(segundos));
    return dos(Math.floor(s / 60)) + ':' + dos(s % 60);
  }

  /* ------------------------------------------------------------------ */
  /* Cliente de Firebase por REST                                        */
  /* ------------------------------------------------------------------ */

  function traducirErrorAuth(codigo) {
    var c = String(codigo || '');
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(c)) return 'Correo o contraseña incorrectos.';
    if (/USER_DISABLED/.test(c)) return 'Esta cuenta está deshabilitada.';
    if (/TOO_MANY_ATTEMPTS/.test(c)) return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    if (/API key not valid|API_KEY_INVALID|INVALID_API_KEY/i.test(c)) return 'La API key de config.js no es válida.';
    if (/OPERATION_NOT_ALLOWED/.test(c)) return 'El inicio de sesión con correo y contraseña no está activado en Firebase.';
    return 'No se pudo iniciar sesión (' + (c || 'error desconocido') + ').';
  }

  function crearDB(opciones) {
    var base = String(opciones.databaseURL || '').replace(/\/+$/, '');
    var apiKey = opciones.apiKey;
    var hacer = opciones.fetchImpl || function () { return globalThis.fetch.apply(globalThis, arguments); };
    var sesion = null;

    function errorHTTP(resp, datos, ruta) {
      var msg = datos && typeof datos === 'object' && datos.error ? datos.error : ('HTTP ' + resp.status);
      var e = new Error(String(msg));
      e.status = resp.status;
      e.ruta = ruta;
      e.denegado = resp.status === 401 || resp.status === 403;
      return e;
    }

    function leerJSON(resp) {
      return resp.text().then(function (t) {
        if (!t) return null;
        try { return JSON.parse(t); } catch (e) { return t; }
      });
    }

    function pedir(metodo, ruta, cuerpo, op) {
      op = op || {};
      var previo = op.auth ? asegurarToken() : Promise.resolve();
      return previo.then(function () {
        var q = [];
        if (op.shallow) q.push('shallow=true');
        if (op.auth && sesion) q.push('auth=' + encodeURIComponent(sesion.idToken));
        var url = base + '/' + String(ruta).replace(/^\/+/, '') + '.json' + (q.length ? '?' + q.join('&') : '');
        var init = { method: metodo, cache: 'no-store' };
        if (cuerpo !== undefined) init.body = JSON.stringify(cuerpo);
        return hacer(url, init).then(function (resp) {
          return leerJSON(resp).then(function (datos) {
            if (!resp.ok) throw errorHTTP(resp, datos, ruta);
            return datos;
          });
        });
      });
    }

    function guardarSesion(j) {
      sesion = {
        idToken: j.idToken || j.id_token,
        refreshToken: j.refreshToken || j.refresh_token,
        expira: Date.now() + (Number(j.expiresIn || j.expires_in) || 3600) * 1000 - 120000,
        email: j.email || (sesion && sesion.email) || ''
      };
      return sesion;
    }

    function iniciarSesion(email, clave) {
      return hacer('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: clave, returnSecureToken: true })
      }).then(function (resp) {
        return leerJSON(resp).then(function (j) {
          if (!resp.ok) {
            var e = new Error(traducirErrorAuth(j && j.error && j.error.message));
            e.status = resp.status;
            throw e;
          }
          return guardarSesion(j);
        });
      });
    }

    function refrescar(refreshToken) {
      var token = refreshToken || (sesion && sesion.refreshToken);
      if (!token) return Promise.reject(new Error('Sesión vencida. Vuelve a ingresar.'));
      return hacer('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(token)
      }).then(function (resp) {
        return leerJSON(resp).then(function (j) {
          if (!resp.ok) throw new Error('Sesión vencida. Vuelve a ingresar.');
          var antes = sesion && sesion.email;
          var s = guardarSesion(j);
          if (!s.email && antes) s.email = antes;
          return s;
        });
      });
    }

    function asegurarToken() {
      if (!sesion) return Promise.reject(new Error('Debes iniciar sesión.'));
      if (Date.now() > sesion.expira) return refrescar().then(function () {});
      return Promise.resolve();
    }

    return {
      get: function (ruta, op) { return pedir('GET', ruta, undefined, op); },
      put: function (ruta, cuerpo, op) { return pedir('PUT', ruta, cuerpo, op); },
      patch: function (ruta, cuerpo, op) { return pedir('PATCH', ruta, cuerpo, op); },
      del: function (ruta, op) { return pedir('DELETE', ruta, undefined, op); },
      iniciarSesion: iniciarSesion,
      refrescar: refrescar,
      sesion: function () { return sesion; },
      cerrarSesion: function () { sesion = null; }
    };
  }

  // Valor que Firebase reemplaza por la hora de su servidor.
  var HORA_SERVIDOR = { '.sv': 'timestamp' };

  return {
    ALFABETO: ALFABETO, LETRAS: LETRAS, GRACIA_MS: GRACIA_MS, HORA_SERVIDOR: HORA_SERVIDOR,
    sha256Hex: sha256Hex, tokenAleatorio: tokenAleatorio, escaparHTML: escaparHTML,
    normalizarCodigo: normalizarCodigo, formatearCodigoEntrada: formatearCodigoEntrada,
    codigoValido: codigoValido, generarCodigo: generarCodigo,
    normalizarDocumento: normalizarDocumento, validarEstudiante: validarEstudiante, hashCodigo: hashCodigo,
    claveEstudiante: claveEstudiante, comprobante: comprobante,
    mulberry32: mulberry32, semillaDesdeHex: semillaDesdeHex, barajar: barajar,
    prepararExamen: prepararExamen, listaDe: listaDe,
    validarExamen: validarExamen, separarExamen: separarExamen,
    calificar: calificar, notaLineal: notaLineal,
    resumenPorUniversidad: resumenPorUniversidad, analisisPreguntas: analisisPreguntas,
    aCSV: aCSV, decimalES: decimalES,
    formatoFechaHora: formatoFechaHora, formatoMinSeg: formatoMinSeg,
    crearDB: crearDB, traducirErrorAuth: traducirErrorAuth
  };
});
