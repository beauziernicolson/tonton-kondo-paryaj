/*
 * Tonton Kondo i18n foundation
 *
 * Purpose:
 *   - provide a small, reusable, vanilla JavaScript translation engine
 *   - support fr / ht / en with a simple nested-key lookup API
 *   - load JSON locale files from the project locales directory
 *   - translate DOM elements via data-i18n attributes without innerHTML
 *
 * Supported languages:
 *   fr, ht, en
 *
 * Examples:
 *   window.TKI18n.init({ language: 'en' });
 *   window.TKI18n.t('common.save');
 *   window.TKI18n.t('test.amount', { amount: 500, currency: 'HTG' });
 *
 * DOM example:
 *   <h1 data-i18n="common.profile">Profil</h1>
 *   <span data-i18n="test.amount" data-i18n-vars='{"amount":500,"currency":"HTG"}'></span>
 */
(function (global) {
  'use strict';

  const SUPPORTED_LANGUAGES = ['fr', 'ht', 'en'];
  const DEFAULT_LANGUAGE = 'fr';
  const LOCAL_STORAGE_KEY = 'tk_language';
  const translationsCache = new Map();
  const loadingPromises = new Map();
  const languageChangeCallbacks = new Set();

  function normalizeLanguage(language) {
    const normalized = String(language || '').trim().toLowerCase();
    if (!normalized) {
      return DEFAULT_LANGUAGE;
    }

    const languagePrefix = normalized.split('-')[0];
    if (languagePrefix === 'fr') {
      return 'fr';
    }
    if (languagePrefix === 'ht') {
      return 'ht';
    }
    if (languagePrefix === 'en') {
      return 'en';
    }

    return DEFAULT_LANGUAGE;
  }

  function safeParseJson(value) {
    if (!value) {
      return {};
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn('Invalid data-i18n-vars JSON:', error);
      return {};
    }
  }

  function getNestedValue(object, key) {
    return String(key || '')
      .split('.')
      .reduce((currentValue, part) => {
        if (currentValue && Object.prototype.hasOwnProperty.call(currentValue, part)) {
          return currentValue[part];
        }
        return undefined;
      }, object);
  }

  function buildLocaleUrl(language) {
    const normalizedLanguage = normalizeLanguage(language);

    try {
      const currentScript = global.document?.currentScript;
      if (currentScript && currentScript.src) {
        const scriptUrl = new URL(currentScript.src, global.location?.href || '');
        const localesBaseUrl = new URL('../locales/', scriptUrl);
        return new URL(`${normalizedLanguage}.json`, localesBaseUrl);
      }
    } catch (error) {
      console.warn('Unable to resolve locales URL from currentScript, using fallback.', error);
    }

    const fallbackBaseUrl = new URL('../locales/', global.location?.href || 'http://localhost/');
    return new URL(`${normalizedLanguage}.json`, fallbackBaseUrl);
  }

  async function fetchLanguageFile(language) {
    const normalizedLanguage = normalizeLanguage(language);
    if (translationsCache.has(normalizedLanguage)) {
      return translationsCache.get(normalizedLanguage);
    }

    if (loadingPromises.has(normalizedLanguage)) {
      return loadingPromises.get(normalizedLanguage);
    }

    const loadingPromise = (async () => {
      try {
        const response = await fetch(buildLocaleUrl(normalizedLanguage).href, {
          headers: {
            Accept: 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json();
        const translations = json && typeof json === 'object' ? json : {};
        translationsCache.set(normalizedLanguage, translations);
        return translations;
      } catch (error) {
        console.warn(`Unable to load locale ${normalizedLanguage}, falling back to fr.`, error);

        if (normalizedLanguage !== DEFAULT_LANGUAGE) {
          try {
            const fallbackResponse = await fetch(buildLocaleUrl(DEFAULT_LANGUAGE).href, {
              headers: {
                Accept: 'application/json'
              }
            });

            if (!fallbackResponse.ok) {
              throw new Error(`HTTP ${fallbackResponse.status}`);
            }

            const fallbackJson = await fallbackResponse.json();
            const fallbackTranslations = fallbackJson && typeof fallbackJson === 'object' ? fallbackJson : {};
            translationsCache.set(normalizedLanguage, fallbackTranslations);
            return fallbackTranslations;
          } catch (fallbackError) {
            console.error(`Unable to load fallback locale ${DEFAULT_LANGUAGE}.`, fallbackError);
            const emptyTranslations = {};
            translationsCache.set(normalizedLanguage, emptyTranslations);
            return emptyTranslations;
          }
        }

        const emptyTranslations = {};
        translationsCache.set(normalizedLanguage, emptyTranslations);
        return emptyTranslations;
      } finally {
        loadingPromises.delete(normalizedLanguage);
      }
    })();

    loadingPromises.set(normalizedLanguage, loadingPromise);
    return loadingPromise;
  }

  function renderInterpolation(template, variables) {
    return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, variableName) => {
      const variableValue = variables && Object.prototype.hasOwnProperty.call(variables, variableName)
        ? variables[variableName]
        : undefined;

      if (variableValue === undefined || variableValue === null) {
        return '';
      }

      return String(variableValue);
    });
  }

  function resolveInitialLanguage(options) {
    const explicitLanguage = normalizeLanguage(options?.language);
    if (SUPPORTED_LANGUAGES.includes(explicitLanguage)) {
      return explicitLanguage;
    }

    if (typeof options?.remoteLanguageLoader === 'function') {
      return Promise.resolve(options.remoteLanguageLoader()).then((remoteLanguage) => normalizeLanguage(remoteLanguage));
    }

    try {
      const storedLanguage = global.localStorage?.getItem(LOCAL_STORAGE_KEY);
      if (storedLanguage) {
        return normalizeLanguage(storedLanguage);
      }
    } catch (error) {
      console.warn('Unable to read localStorage language.', error);
    }

    const docLang = normalizeLanguage(global.document?.documentElement?.lang);
    if (SUPPORTED_LANGUAGES.includes(docLang)) {
      return docLang;
    }

    const navigatorLanguage = normalizeLanguage(global.navigator?.language);
    if (SUPPORTED_LANGUAGES.includes(navigatorLanguage)) {
      return navigatorLanguage;
    }

    return DEFAULT_LANGUAGE;
  }

  let currentLanguage = DEFAULT_LANGUAGE;
  let translations = {};

  function hideDocumentUntilReady() {
    if (!global.document || !global.document.documentElement) {
      return;
    }

    global.document.documentElement.classList.add('tk-i18n-loading');
  }

  function showDocumentWhenReady() {
    if (!global.document || !global.document.documentElement) {
      return;
    }

    global.document.documentElement.classList.remove('tk-i18n-loading');
  }

  function applyTranslations(root) {
    const targetRoot = root || global.document;
    if (!targetRoot) {
      return;
    }

    targetRoot.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.dataset.i18n;
      const variables = safeParseJson(element.dataset.i18nVars);
      const translatedValue = TKI18n.t(key, variables);
      if (translatedValue !== undefined && translatedValue !== null) {
        element.textContent = translatedValue;
      }
    });

    targetRoot.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const key = element.dataset.i18nPlaceholder;
      const translatedValue = TKI18n.t(key);
      if (translatedValue !== undefined && translatedValue !== null) {
        element.setAttribute('placeholder', translatedValue);
      }
    });

    targetRoot.querySelectorAll('[data-i18n-title]').forEach((element) => {
      const key = element.dataset.i18nTitle;
      const translatedValue = TKI18n.t(key);
      if (translatedValue !== undefined && translatedValue !== null) {
        element.setAttribute('title', translatedValue);
      }
    });

    targetRoot.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      const key = element.dataset.i18nAriaLabel;
      const translatedValue = TKI18n.t(key);
      if (translatedValue !== undefined && translatedValue !== null) {
        element.setAttribute('aria-label', translatedValue);
      }
    });

    targetRoot.querySelectorAll('[data-i18n-value]').forEach((element) => {
      const key = element.dataset.i18nValue;
      const translatedValue = TKI18n.t(key);
      if (translatedValue !== undefined && translatedValue !== null) {
        element.setAttribute('value', translatedValue);
      }
    });
  }

  async function loadLanguage(language) {
    const normalizedLanguage = normalizeLanguage(language);
    return fetchLanguageFile(normalizedLanguage);
  }

  function getLanguage() {
    return currentLanguage;
  }

  async function setLanguage(language, options = {}) {
    const normalizedLanguage = normalizeLanguage(language);
    const parsedOptions = options || {};
    const persistLocal = parsedOptions.persistLocal !== false;
    const persistRemote = parsedOptions.persistRemote === true;
    const apply = parsedOptions.apply !== false;

    const nextTranslations = await loadLanguage(normalizedLanguage);
    currentLanguage = normalizedLanguage;
    translations = nextTranslations || {};

    if (global.document?.documentElement) {
      global.document.documentElement.lang = normalizedLanguage;
    }

    if (persistLocal) {
      try {
        global.localStorage?.setItem(LOCAL_STORAGE_KEY, normalizedLanguage);
      } catch (error) {
        console.warn('Unable to persist language in localStorage.', error);
      }
    }

    if (persistRemote) {
      console.warn('persistRemote is configured but no remote save is performed in this phase.');
    }

    if (apply) {
      applyTranslations(global.document);
    }

    languageChangeCallbacks.forEach((callback) => {
      try {
        callback({
          language: normalizedLanguage,
          translations: translations || {}
        });
      } catch (error) {
        console.error('i18n callback failed:', error);
      }
    });

    global.dispatchEvent(
      new global.CustomEvent('tk:language-changed', {
        detail: {
          language: normalizedLanguage,
          translations: translations || {}
        }
      })
    );

    return normalizedLanguage;
  }

  async function init(options = {}) {
    const normalizedOptions = options || {};
    const hideUntilReady = normalizedOptions.hideUntilReady === true;

    if (hideUntilReady) {
      hideDocumentUntilReady();
    }

    let resolvedLanguage = normalizeLanguage(normalizedOptions.language);
    if (!SUPPORTED_LANGUAGES.includes(resolvedLanguage)) {
      const remoteLanguageLoader = normalizedOptions.remoteLanguageLoader;
      if (typeof remoteLanguageLoader === 'function') {
        try {
          const remoteLanguage = await remoteLanguageLoader();
          resolvedLanguage = normalizeLanguage(remoteLanguage);
        } catch (error) {
          console.warn('remoteLanguageLoader failed.', error);
        }
      }

      if (!SUPPORTED_LANGUAGES.includes(resolvedLanguage)) {
        try {
          const localStoredLanguage = global.localStorage?.getItem(LOCAL_STORAGE_KEY);
          if (localStoredLanguage) {
            resolvedLanguage = normalizeLanguage(localStoredLanguage);
          }
        } catch (error) {
          console.warn('Unable to read localStorage during init.', error);
        }
      }

      if (!SUPPORTED_LANGUAGES.includes(resolvedLanguage)) {
        const documentLanguage = normalizeLanguage(global.document?.documentElement?.lang);
        if (SUPPORTED_LANGUAGES.includes(documentLanguage)) {
          resolvedLanguage = documentLanguage;
        }
      }

      if (!SUPPORTED_LANGUAGES.includes(resolvedLanguage)) {
        const navigatorLanguage = normalizeLanguage(global.navigator?.language);
        if (SUPPORTED_LANGUAGES.includes(navigatorLanguage)) {
          resolvedLanguage = navigatorLanguage;
        }
      }

      if (!SUPPORTED_LANGUAGES.includes(resolvedLanguage)) {
        resolvedLanguage = DEFAULT_LANGUAGE;
      }
    }

    try {
      await setLanguage(resolvedLanguage, {
        persistLocal: normalizedOptions.useLocalStorage !== false,
        persistRemote: false,
        apply: normalizedOptions.autoApply !== false
      });
    } catch (error) {
      console.error('TKI18n initialization failed:', error);
    } finally {
      if (hideUntilReady) {
        showDocumentWhenReady();
      }
    }

    return currentLanguage;
  }

  function onLanguageChanged(callback) {
    if (typeof callback === 'function') {
      languageChangeCallbacks.add(callback);
    }
  }

  function offLanguageChanged(callback) {
    if (typeof callback === 'function') {
      languageChangeCallbacks.delete(callback);
    }
  }

  function t(key, variables = {}) {
    const normalizedKey = String(key || '');
    const translationsForCurrentLanguage = translationsCache.get(currentLanguage) || {};
    const translationFromCurrent = getNestedValue(translationsForCurrentLanguage, normalizedKey);

    if (translationFromCurrent !== undefined && translationFromCurrent !== null) {
      return renderInterpolation(translationFromCurrent, variables || {});
    }

    const fallbackTranslations = translationsCache.get(DEFAULT_LANGUAGE) || {};
    const fallbackValue = getNestedValue(fallbackTranslations, normalizedKey);
    if (fallbackValue !== undefined && fallbackValue !== null) {
      return renderInterpolation(fallbackValue, variables || {});
    }

    console.warn('Missing translation:', currentLanguage, normalizedKey);
    return normalizedKey;
  }

  const TKI18n = {
    init,
    t,
    setLanguage,
    getLanguage,
    applyTranslations,
    loadLanguage,
    onLanguageChanged,
    offLanguageChanged,
    hideDocumentUntilReady,
    showDocumentWhenReady,
    normalizeLanguage,
    SUPPORTED_LANGUAGES
  };

  global.TKI18n = TKI18n;

  if (!global.t) {
    global.t = function tGlobal(...args) {
      return global.TKI18n.t(...args);
    };
  } else {
    console.warn('window.t already exists; leaving it untouched.');
  }

  if (!global.setLanguage) {
    global.setLanguage = function setLanguageGlobal(...args) {
      return global.TKI18n.setLanguage(...args);
    };
  } else {
    console.warn('window.setLanguage already exists; leaving it untouched.');
  }

  if (!global.getCurrentLanguage) {
    global.getCurrentLanguage = function getCurrentLanguageGlobal() {
      return global.TKI18n.getLanguage();
    };
  } else {
    console.warn('window.getCurrentLanguage already exists; leaving it untouched.');
  }
})(window);
