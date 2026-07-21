-- Étape 11 — réconciliation automatique des dépôts/retraits PlopPlop en attente.
-- Ne rembourse ni ne crédite jamais à l'aveugle : appelle exactement la même
-- logique de vérification que les boutons "Vérifier" existants, toutes les 2 minutes,
-- indépendamment du navigateur du client.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'plopplop-reconcile-pending',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://jkzfkllmxqjmdaxbaaab.supabase.co/functions/v1/plopplop-reconcile-pending',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'plopplop_reconcile_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
