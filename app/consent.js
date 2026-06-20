/*
 * consent.js — Consentimento de cookies (RGPD/ePrivacy).
 * O Google Analytics SÓ é carregado depois de o utilizador clicar "Aceitar".
 * A escolha (granted/denied) fica em localStorage; se rejeitar, o GA nunca
 * carrega e não são criados cookies de análise. Incluir em todas as páginas.
 */
(function () {
  'use strict';

  var GA_ID = 'G-H67Q3FKX67';
  var KEY = 'metro-consent-v1';

  function loadGA() {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  var choice = stored();
  if (choice === 'granted') { loadGA(); return; }
  if (choice === 'denied') { return; }

  // Sem decisão — mostrar banner (não bloqueia o uso da app).
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function decide(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* sem persistência */ }
    if (banner.parentNode) banner.parentNode.removeChild(banner);
    if (value === 'granted') loadGA();
  }

  var banner = el('div', 'consent-banner');
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Consentimento de cookies');

  var text = el('p', 'consent-text');
  text.textContent = 'Usamos cookies do Google Analytics apenas para medir a ' +
    'utilização do site e melhorá-lo. Pode aceitar ou recusar — o site funciona ' +
    'na mesma.';
  banner.appendChild(text);

  var actions = el('div', 'consent-actions');
  var reject = el('button', 'consent-btn consent-reject', 'Recusar');
  reject.type = 'button';
  reject.addEventListener('click', function () { decide('denied'); });
  var accept = el('button', 'consent-btn consent-accept', 'Aceitar');
  accept.type = 'button';
  accept.addEventListener('click', function () { decide('granted'); });
  actions.appendChild(reject);
  actions.appendChild(accept);
  banner.appendChild(actions);

  function mount() { document.body.appendChild(banner); }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
