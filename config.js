/*
 * CONFIGURACIÓN — es el único archivo que debes editar.
 *
 * 1) Pega la API key y la URL de tu proyecto de Firebase (ver LEEME.md, paso 2).
 * 2) Ajusta la lista de universidades si hace falta.
 *
 * Estos datos NO son secretos: cualquier página web de Firebase los muestra.
 * La seguridad la dan las reglas de la base de datos (reglas-firebase.json).
 */
window.EXAMEN_CONFIG = {
  apiKey: 'AIzaSyBnAAI-1UT4FV1yIx52uh5jai_BiIUWZv8',
  databaseURL: 'https://examen-final-pediatria-default-rtdb.firebaseio.com',

  // Lista desplegable que ven los estudiantes al ingresar.
  universidades: [
    'Universidad de La Sabana',
    'Universidad El Bosque',
    'Pontificia Universidad Javeriana',
    'Universidad de los Andes'
  ],

  // Porcentaje de aciertos a partir del cual el panel docente cuenta "aprobó".
  umbralAprobacionPct: 60,

  // Título que aparece en la página de ingreso.
  titulo: 'Examen de fin de rotación'
};
