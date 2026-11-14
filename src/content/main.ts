/**
 * Único content script de las pantallas de Gavriel (al terminar de cargar): une los valores por
 * defecto al abrir una cuenta (account.ts) con los atajos y la tarjeta de llamada (shortcuts.ts).
 * Juntos comparten una sola copia del código común, una lectura de ajustes y un solo observador del DOM.
 */
import './account';
import './shortcuts';
