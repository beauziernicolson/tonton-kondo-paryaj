/**
 * Configuration Supabase Auth.
 * Les valeurs ci-dessous sont utilisées par l’authentification Tonton Kondo.
 */

const SUPABASE_URL = 'https://jkzfkllmxqjmdaxbaaab.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpremZrbGxteHFqbWRheGJhYWFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTExMDAsImV4cCI6MjA5NjkyNzEwMH0.fRsg-NIAbEk3MJY3hIyEjAub-zgAm6K5F7xWwPpMNU8';
const AUTH_CONFIG_SCRIPT_URL = document.currentScript?.src || '';

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

/*
 * Étape 9C — charge le module RPC des cinq jeux traditionnels avant
 * les anciens scripts de page. Aucun jeu n’est masqué ou désactivé.
 */
(function loadTraditionalGamesSecurity() {
  if (!AUTH_CONFIG_SCRIPT_URL) {
    console.error('Impossible de localiser traditional-games-secure.js.');
    return;
  }

  const secureModuleUrl = new URL(
    'traditional-games-secure.js',
    AUTH_CONFIG_SCRIPT_URL
  ).href;

  document.write(
    '<script src="' + secureModuleUrl
      + '" data-tk-step9c="traditional-games-secure"><\/script>'
  );
})();

/*
 * Étape 10A — branche la page deposit.html sur les Edge Functions PlopPlop.
 * Ce module ne contient aucun identifiant fournisseur ni aucune clé serveur.
 */
(function loadPlopPlopDeposit() {
  if (!/\/deposit\.html$/i.test(window.location.pathname)) {
    return;
  }

  if (!AUTH_CONFIG_SCRIPT_URL) {
    console.error('Impossible de localiser plopplop-deposit.js.');
    return;
  }

  const moduleUrl = new URL('plopplop-deposit.js', AUTH_CONFIG_SCRIPT_URL).href;
  document.write(
    '<script src="' + moduleUrl
      + '" data-tk-step10a="plopplop-deposit"><\/script>'
  );
})();