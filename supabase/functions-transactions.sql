-- Tonton Kondo – Phase 1.6 : fonction sécurisée apply_transaction()
-- Cette fonction modifie le wallet uniquement via une transaction contrôlée.
-- Elle doit être appelée par un backend, une Edge Function, un service role
-- ou un administrateur contrôlé. Ne pas exposer cette fonction directement aux clients.

CREATE OR REPLACE FUNCTION public.apply_transaction(
  p_user_id uuid,
  p_type text,
  p_amount numeric,
  p_reference text,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_new_balance numeric;
  v_transaction public.transactions%ROWTYPE;
BEGIN
  -- 1. Validation de base
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être strictement positif.';
  END IF;

  IF p_type NOT IN ('deposit', 'withdrawal', 'bet', 'win', 'refund', 'commission', 'adjustment') THEN
    RAISE EXCEPTION 'Type de transaction non autorisé.';
  END IF;

  -- 2. Récupérer le wallet du compte utilisateur
  SELECT *
    INTO v_wallet
    FROM public.wallets
   WHERE user_id = p_user_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun wallet trouvé pour cet utilisateur.';
  END IF;

  -- 3. Calculer l’impact sur le solde
  IF p_type IN ('deposit', 'win', 'refund', 'commission', 'adjustment') THEN
    v_new_balance := v_wallet.balance + p_amount;
  ELSE
    v_new_balance := v_wallet.balance - p_amount;
  END IF;

  -- 4. Empêcher un solde négatif pour les opérations qui diminuent le wallet
  IF p_type IN ('withdrawal', 'bet') AND v_new_balance < 0 THEN
    RAISE EXCEPTION 'Solde insuffisant pour cette transaction.';
  END IF;

  -- 5. Transaction atomique : tout doit réussir ou rien ne doit être enregistré.
  INSERT INTO public.transactions (
    user_id,
    wallet_id,
    type,
    amount,
    currency,
    status,
    reference,
    description,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    v_wallet.id,
    p_type,
    p_amount,
    COALESCE(v_wallet.currency, 'HTG'),
    'completed',
    p_reference,
    p_description,
    COALESCE(p_metadata, '{}'::jsonb),
    auth.uid(),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_transaction;

  UPDATE public.wallets
     SET balance = v_new_balance,
         updated_at = NOW()
   WHERE id = v_wallet.id;

  INSERT INTO public.activity_logs (user_id, action, details, created_at)
  VALUES (
    p_user_id,
    'transaction_applied',
    jsonb_build_object(
      'transaction_id', v_transaction.id,
      'type', p_type,
      'amount', p_amount,
      'reference', p_reference,
      'new_balance', v_new_balance,
      'metadata', COALESCE(p_metadata, '{}'::jsonb)
    ),
    NOW()
  );

  RETURN v_transaction;
END;
$$;

COMMENT ON FUNCTION public.apply_transaction(uuid, text, numeric, text, text, jsonb) IS
 'Fonction SQL sécurisée pour appliquer une transaction financière à un wallet.
  Cette fonction doit être appelée uniquement par un backend, une Edge Function,
  un service role ou un administrateur contrôlé.
  Ne pas exposer directement cette fonction aux clients sans vérification stricte.';
