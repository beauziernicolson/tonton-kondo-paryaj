/* Tonton Kondo — localisation des jeux avancés. */
(function(global){
 'use strict';
 function t(key,variables={}){
   const full=key.startsWith('games_group2.')?key:`games_group2.${key}`;
   return global.TKI18n?.t?global.TKI18n.t(full,variables):full;
 }
 global.TKGamesGroup2I18n={t};
 global.group2T=t;
})(window);
