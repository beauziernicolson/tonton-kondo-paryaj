/* Tonton Kondo — localisation commune aux jeux. */
(function(global){
  'use strict';
  function t(key, variables={}){
    const fullKey = key.startsWith('games_common.') ? key : `games_common.${key}`;
    if(global.TKI18n?.t) return global.TKI18n.t(fullKey, variables);
    return fullKey;
  }
  function apply(root=document){ global.TKI18n?.applyTranslations?.(root); }
  global.TKGameI18n={t,apply};
  global.gameT=t;
})(window);
