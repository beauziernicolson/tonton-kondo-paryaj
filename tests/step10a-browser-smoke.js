/*
 * Étape 10A — test navigateur après déploiement de la version complète.
 * Exécuter depuis deposit.html avec une vraie session utilisateur.
 * Le script n'affiche jamais le JWT et ne déclenche aucune création réelle.
 */
(async () => {
  const client = window.supabaseClient || await window.getSupabaseClient?.();
  if (!client) throw new Error('Client Supabase indisponible.');

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error('Session utilisateur requise.');

  const invalidAmount = await client.functions.invoke('plopplop-create-payment', {
    body: {
      request_id: crypto.randomUUID(),
      amount: 19,
      payment_method: 'moncash'
    }
  });

  const invalidMethod = await client.functions.invoke('plopplop-create-payment', {
    body: {
      request_id: crypto.randomUUID(),
      amount: 20,
      payment_method: 'manual'
    }
  });

  console.table([
    {
      test: 'Montant 19 HTG refusé',
      passed: Boolean(invalidAmount.error),
      status: invalidAmount.error?.context?.status ?? 'n/a'
    },
    {
      test: 'Méthode invalide refusée',
      passed: Boolean(invalidMethod.error),
      status: invalidMethod.error?.context?.status ?? 'n/a'
    }
  ]);
})();
