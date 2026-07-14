/*
 * Tonton Kondo — moteur i18n global (fr / ht / en)
 *
 * Deux modes complémentaires :
 * 1) Clés structurées : data-i18n="wallet.title" et TKI18n.t('wallet.title').
 * 2) Migration automatique : traduit les anciens textes visibles avec auto.exact
 *    et auto.phrases dans les fichiers locales/*.json.
 *
 * Exemples :
 *   await TKI18n.init();
 *   TKI18n.t('common.save');
 *   await TKI18n.setLanguage('ht');
 */
(function (global) {
  'use strict';

  const SUPPORTED_LANGUAGES = ['fr', 'ht', 'en'];
  const DEFAULT_LANGUAGE = 'fr';
  const LOCAL_STORAGE_KEY = 'tk_language';
  const translationsCache = new Map();
  const loadingPromises = new Map();
  const languageChangeCallbacks = new Set();
  const originalTextNodes = new WeakMap();
  const originalAttributes = new WeakMap();

  let currentLanguage = DEFAULT_LANGUAGE;
  let translations = {};
  let mutationObserver = null;
  let observerEnabled = false;
  let applyingTranslations = false;

  function normalizeLanguage(language) {
    const normalized = String(language || '').trim().toLowerCase();
    const prefix = normalized.split('-')[0];
    return SUPPORTED_LANGUAGES.includes(prefix) ? prefix : DEFAULT_LANGUAGE;
  }

  function safeParseJson(value) {
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn('Invalid data-i18n-vars JSON:', error);
      return {};
    }
  }

  function getNestedValue(object, key) {
    return String(key || '').split('.').reduce((value, part) => {
      if (value && Object.prototype.hasOwnProperty.call(value, part)) return value[part];
      return undefined;
    }, object);
  }

  function getScriptUrl() {
    const direct = global.document?.currentScript;
    if (direct?.src) return direct.src;
    const scripts = Array.from(global.document?.scripts || []);
    const match = scripts.reverse().find((script) => /(?:^|\/)i18n\.js(?:[?#].*)?$/.test(script.src || ''));
    return match?.src || null;
  }

  function buildLocaleUrl(language) {
    const normalized = normalizeLanguage(language);
    const scriptSrc = getScriptUrl();
    if (scriptSrc) return new URL(`${normalized}.json`, new URL('../locales/', scriptSrc));
    return new URL(`locales/${normalized}.json`, global.location?.origin + global.location?.pathname.replace(/[^/]*$/, ''));
  }

  async function fetchLanguageFile(language) {
    const normalized = normalizeLanguage(language);
    if (translationsCache.has(normalized)) return translationsCache.get(normalized);
    if (loadingPromises.has(normalized)) return loadingPromises.get(normalized);

    const promise = (async () => {
      try {
        const response = await fetch(buildLocaleUrl(normalized).href, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const dictionary = data && typeof data === 'object' ? data : {};
        translationsCache.set(normalized, dictionary);
        return dictionary;
      } catch (error) {
        console.warn(`Unable to load locale ${normalized}.`, error);
        if (normalized !== DEFAULT_LANGUAGE) return fetchLanguageFile(DEFAULT_LANGUAGE);
        translationsCache.set(DEFAULT_LANGUAGE, {});
        return {};
      } finally {
        loadingPromises.delete(normalized);
      }
    })();

    loadingPromises.set(normalized, promise);
    return promise;
  }

  function renderInterpolation(template, variables = {}) {
    return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
      const value = Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : '';
      return value === null || value === undefined ? '' : String(value);
    });
  }

  function t(key, variables = {}) {
    const normalizedKey = String(key || '');
    const currentDictionary = translationsCache.get(currentLanguage) || translations || {};
    const currentValue = getNestedValue(currentDictionary, normalizedKey);
    if (typeof currentValue === 'string' || typeof currentValue === 'number') {
      return renderInterpolation(currentValue, variables);
    }
    const fallback = translationsCache.get(DEFAULT_LANGUAGE) || {};
    const fallbackValue = getNestedValue(fallback, normalizedKey);
    if (typeof fallbackValue === 'string' || typeof fallbackValue === 'number') {
      return renderInterpolation(fallbackValue, variables);
    }
    console.warn('Missing translation:', currentLanguage, normalizedKey);
    return normalizedKey;
  }

  function shouldSkipElement(element) {
    if (!element || element.nodeType !== 1) return false;
    return Boolean(element.closest('script, style, svg, code, pre, textarea, [data-i18n-ignore]'));
  }

  function rememberAttribute(element, name) {
    let values = originalAttributes.get(element);
    if (!values) {
      values = {};
      originalAttributes.set(element, values);
    }
    if (!Object.prototype.hasOwnProperty.call(values, name)) values[name] = element.getAttribute(name);
    return values[name];
  }

  function translateLegacyText(source) {
    const value = String(source ?? '');
    if (currentLanguage === DEFAULT_LANGUAGE || !value.trim()) return value;
    const auto = translations?.auto || {};
    const exact = auto.exact || {};
    const trimmed = value.trim();
    const leading = value.slice(0, value.indexOf(trimmed));
    const trailing = value.slice(value.indexOf(trimmed) + trimmed.length);
    if (Object.prototype.hasOwnProperty.call(exact, trimmed)) return leading + exact[trimmed] + trailing;

    let translated = trimmed;
    const phrases = auto.phrases || {};
    Object.keys(phrases).sort((a, b) => b.length - a.length).forEach((phrase) => {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      translated = translated.replace(new RegExp(escaped, 'gi'), phrases[phrase]);
    });
    return leading + translated + trailing;
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement || shouldSkipElement(node.parentElement)) return;
    if (node.parentElement.closest('[data-i18n]')) return;
    if (!originalTextNodes.has(node)) originalTextNodes.set(node, node.nodeValue);
    const source = originalTextNodes.get(node);
    node.nodeValue = translateLegacyText(source);
  }

  function applyLegacyTranslations(root) {
    const base = root?.nodeType === Node.TEXT_NODE ? root.parentNode : root;
    if (!base) return;
    const documentRef = base.ownerDocument || global.document;
    const walker = documentRef.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateTextNode);

    const elements = [];
    if (base.nodeType === Node.ELEMENT_NODE) elements.push(base);
    if (base.querySelectorAll) elements.push(...base.querySelectorAll('[placeholder], [title], [aria-label]'));
    elements.forEach((element) => {
      if (shouldSkipElement(element)) return;
      ['placeholder', 'title', 'aria-label'].forEach((name) => {
        if (!element.hasAttribute(name) || element.hasAttribute(`data-i18n-${name}`)) return;
        const source = rememberAttribute(element, name);
        if (source !== null) element.setAttribute(name, translateLegacyText(source));
      });
    });
  }

  function applyKeyedTranslations(root) {
    const target = root || global.document;
    if (!target?.querySelectorAll) return;
    const includeSelf = (selector) => target.matches?.(selector) ? [target] : [];

    [...includeSelf('[data-i18n]'), ...target.querySelectorAll('[data-i18n]')].forEach((element) => {
      element.textContent = t(element.dataset.i18n, safeParseJson(element.dataset.i18nVars));
    });
    const attributeMappings = [
      ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-title', 'title'],
      ['data-i18n-aria-label', 'aria-label'],
      ['data-i18n-value', 'value']
    ];
    attributeMappings.forEach(([selectorAttribute, targetAttribute]) => {
      const selector = `[${selectorAttribute}]`;
      [...includeSelf(selector), ...target.querySelectorAll(selector)].forEach((element) => {
        element.setAttribute(targetAttribute, t(element.getAttribute(selectorAttribute)));
      });
    });
  }

  function applyTranslations(root = global.document) {
    if (!root || applyingTranslations) return;
    applyingTranslations = true;
    try {
      applyKeyedTranslations(root);
      applyLegacyTranslations(root);
    } finally {
      applyingTranslations = false;
    }
  }

  function stopMutationObserver() {
    mutationObserver?.disconnect();
    mutationObserver = null;
    observerEnabled = false;
  }

  function startMutationObserver() {
    if (!global.document?.body) return;
    stopMutationObserver();
    observerEnabled = true;
    mutationObserver = new MutationObserver((mutations) => {
      if (applyingTranslations) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            translateTextNode(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            applyTranslations(node);
          }
        }
      }
    });
    // childList only: textContent replacements appear as added text nodes, while
    // translations made by this engine do not retrigger an infinite characterData loop.
    mutationObserver.observe(global.document.body, { childList: true, subtree: true });
  }

  async function loadLanguage(language) {
    return fetchLanguageFile(normalizeLanguage(language));
  }

  function getLanguage() {
    return currentLanguage;
  }

  function getLocale() {
    return currentLanguage === 'en' ? 'en-US' : currentLanguage === 'ht' ? 'ht-HT' : 'fr-FR';
  }

  async function setLanguage(language, options = {}) {
    const normalized = normalizeLanguage(language);
    const next = await loadLanguage(normalized);
    currentLanguage = normalized;
    translations = next || {};
    if (global.document?.documentElement) global.document.documentElement.lang = normalized;

    if (options.persistLocal !== false) {
      try { global.localStorage?.setItem(LOCAL_STORAGE_KEY, normalized); }
      catch (error) { console.warn('Unable to persist language.', error); }
    }
    if (options.persistRemote === true && typeof options.remoteLanguageSaver === 'function') {
      try { await options.remoteLanguageSaver(normalized); }
      catch (error) { console.warn('Unable to persist remote language.', error); }
    }
    if (options.apply !== false) applyTranslations(global.document);

    const detail = { language: normalized, translations };
    languageChangeCallbacks.forEach((callback) => {
      try { callback(detail); } catch (error) { console.error('i18n callback failed:', error); }
    });
    global.dispatchEvent(new CustomEvent('tk:language-changed', { detail }));
    return normalized;
  }

  async function init(options = {}) {
    const hide = options.hideUntilReady === true;
    if (hide) hideDocumentUntilReady();
    let language = null;
    try {
      if (options.language) language = normalizeLanguage(options.language);
      if (!language && typeof options.remoteLanguageLoader === 'function') {
        try { language = normalizeLanguage(await options.remoteLanguageLoader()); } catch (error) { console.warn('remoteLanguageLoader failed.', error); }
      }
      if (!language && options.useLocalStorage !== false) {
        try {
          const stored = global.localStorage?.getItem(LOCAL_STORAGE_KEY);
          if (stored) language = normalizeLanguage(stored);
        } catch (error) { console.warn('Unable to read language.', error); }
      }
      if (!language) language = normalizeLanguage(global.document?.documentElement?.lang || global.navigator?.language || DEFAULT_LANGUAGE);
      await setLanguage(language, { persistLocal: options.useLocalStorage !== false, apply: options.autoApply !== false });
      if (options.observeMutations !== false) startMutationObserver();
    } catch (error) {
      console.error('TKI18n initialization failed:', error);
    } finally {
      if (hide) showDocumentWhenReady();
    }
    return currentLanguage;
  }

  function hideDocumentUntilReady() { global.document?.documentElement?.classList.add('tk-i18n-loading'); }
  function showDocumentWhenReady() { global.document?.documentElement?.classList.remove('tk-i18n-loading'); }
  function onLanguageChanged(callback) { if (typeof callback === 'function') languageChangeCallbacks.add(callback); }
  function offLanguageChanged(callback) { languageChangeCallbacks.delete(callback); }

  const TKI18n = {
    init, t, setLanguage, getLanguage, applyTranslations, loadLanguage,
    onLanguageChanged, offLanguageChanged, hideDocumentUntilReady,
    showDocumentWhenReady, normalizeLanguage, getLocale, startMutationObserver,
    stopMutationObserver, SUPPORTED_LANGUAGES
  };

  global.TKI18n = TKI18n;
  if (!global.t) global.t = (...args) => TKI18n.t(...args);
  if (!global.setLanguage) global.setLanguage = (...args) => TKI18n.setLanguage(...args);
  if (!global.getCurrentLanguage) global.getCurrentLanguage = () => TKI18n.getLanguage();
})(window);
