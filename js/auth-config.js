/**
 * Configuration Supabase Auth.
 * Les valeurs ci-dessous sont utilisées par l’authentification Tonton Kondo.
 */

const SUPABASE_URL = 'https://jkzfkllmxqjmdaxbaaab.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpremZrbGxteHFqbWRheGJhYWFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTExMDAsImV4cCI6MjA5NjkyNzEwMH0.fRsg-NIAbEk3MJY3hIyEjAub-zgAm6K5F7xWwPpMNU8';

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

/*
 * Étape 9C — charge le module RPC des cinq jeux traditionnels avant
 * les anciens scripts de page. Aucun jeu n’est masqué ou désactivé.
 */
(function loadTraditionalGamesSecurity() {
  const currentScript = document.currentScript;

  if (!currentScript?.src) {
    console.error('Impossible de localiser traditional-games-secure.js.');
    return;
  }

  const secureModuleUrl = new URL(
    'traditional-games-secure.js',
    currentScript.src
  ).href;

  document.write(
    '<script src="' + secureModuleUrl
      + '" data-tk-step9c="traditional-games-secure"><\/script>'
  );
})();
