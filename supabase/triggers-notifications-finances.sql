-- Tonton Kondo — Phase 3B-1
-- Notifications automatiques pour les demandes de dépôt et de retrait.
--
-- Prérequis déjà exécutés :
--   1) supabase/schema-notifications.sql
--   2) supabase/functions-notifications.sql
--   3) supabase/functions-notifications-create.sql
--
-- Ce fichier :
--   - n'insère jamais directement dans public.notifications ;
--   - utilise uniquement public.create_system_notification() ;
--   - ne bloque jamais le flux financier si une notification échoue ;
--   - crée une notification à l'insertion d'une demande ;
--   - crée une notification lorsque le statut passe à approved/rejected ;
--   - évite les doublons grâce à une clé de déduplication stable.

CREATE OR REPLACE FUNCTION public.notify_deposit_request_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency TEXT;
  v_amount_text TEXT;
  v_method TEXT;
  v_status TEXT;
  v_admin_note TEXT;
  v_message TEXT;
BEGIN
  v_currency := COALESCE(NULLIF(btrim(NEW.currency), ''), 'HTG');
  v_amount_text := to_char(COALESCE(NEW.amount, 0), 'FM999G999G999G999G990D00');
  v_method := COALESCE(NULLIF(btrim(NEW.method), ''), 'Non précisé');
  v_status := lower(COALESCE(NULLIF(btrim(NEW.status), ''), 'pending'));
  v_admin_note := NULLIF(btrim(COALESCE(NEW.admin_note, '')), '');

  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.create_system_notification(
        p_recipient_id => NEW.user_id,
        p_type => 'deposit_submitted',
        p_category => 'deposit',
        p_title => 'Demande de dépôt reçue',
        p_message => format(
          'Votre demande de dépôt de %s %s a bien été reçue et est en attente de validation.',
          v_amount_text,
          v_currency
        ),
        p_action_url => 'deposit.html',
        p_action_label => 'Voir mon dépôt',
        p_entity_type => 'deposit_request',
        p_entity_id => NEW.id,
        p_metadata => jsonb_build_object(
          'request_id', NEW.id,
          'amount', NEW.amount,
          'currency', v_currency,
          'method', v_method,
          'status', v_status
        ),
        p_priority => 'normal',
        p_dedup_key => 'deposit_submitted:' || NEW.id::text
      );

    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
      IF v_status IN ('approved', 'confirmed') THEN
        PERFORM public.create_system_notification(
          p_recipient_id => NEW.user_id,
          p_type => 'deposit_approved',
          p_category => 'deposit',
          p_title => 'Dépôt approuvé',
          p_message => format(
            'Votre dépôt de %s %s a été approuvé.',
            v_amount_text,
            v_currency
          ),
          p_action_url => 'wallet.html',
          p_action_label => 'Voir mon portefeuille',
          p_entity_type => 'deposit_request',
          p_entity_id => NEW.id,
          p_metadata => jsonb_build_object(
            'request_id', NEW.id,
            'amount', NEW.amount,
            'currency', v_currency,
            'method', v_method,
            'status', v_status
          ),
          p_priority => 'high',
          p_dedup_key => 'deposit_approved:' || NEW.id::text
        );

      ELSIF v_status IN ('rejected', 'refused') THEN
        v_message := format(
          'Votre demande de dépôt de %s %s a été refusée.',
          v_amount_text,
          v_currency
        );

        IF v_admin_note IS NOT NULL THEN
          v_message := v_message || ' Motif : ' || v_admin_note;
        END IF;

        PERFORM public.create_system_notification(
          p_recipient_id => NEW.user_id,
          p_type => 'deposit_rejected',
          p_category => 'deposit',
          p_title => 'Dépôt refusé',
          p_message => v_message,
          p_action_url => 'deposit.html',
          p_action_label => 'Voir ma demande',
          p_entity_type => 'deposit_request',
          p_entity_id => NEW.id,
          p_metadata => jsonb_build_object(
            'request_id', NEW.id,
            'amount', NEW.amount,
            'currency', v_currency,
            'method', v_method,
            'status', v_status,
            'admin_note', v_admin_note
          ),
          p_priority => 'high',
          p_dedup_key => 'deposit_rejected:' || NEW.id::text
        );
      END IF;
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING
        'Erreur lors de la création de la notification pour le dépôt % : %',
        NEW.id,
        SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_deposit_request_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_deposit_request_change() FROM anon;
REVOKE ALL ON FUNCTION public.notify_deposit_request_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_notify_deposit_request_change
ON public.deposit_requests;

CREATE TRIGGER trg_notify_deposit_request_change
AFTER INSERT OR UPDATE
ON public.deposit_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_deposit_request_change();

CREATE OR REPLACE FUNCTION public.notify_withdrawal_request_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency TEXT;
  v_amount_text TEXT;
  v_method TEXT;
  v_status TEXT;
  v_admin_note TEXT;
  v_message TEXT;
BEGIN
  v_currency := COALESCE(NULLIF(btrim(NEW.currency), ''), 'HTG');
  v_amount_text := to_char(COALESCE(NEW.amount, 0), 'FM999G999G999G999G990D00');
  v_method := COALESCE(NULLIF(btrim(NEW.method), ''), 'Non précisé');
  v_status := lower(COALESCE(NULLIF(btrim(NEW.status), ''), 'pending'));
  v_admin_note := NULLIF(btrim(COALESCE(NEW.admin_note, '')), '');

  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.create_system_notification(
        p_recipient_id => NEW.user_id,
        p_type => 'withdrawal_submitted',
        p_category => 'withdrawal',
        p_title => 'Demande de retrait reçue',
        p_message => format(
          'Votre demande de retrait de %s %s a bien été reçue et est en attente de validation.',
          v_amount_text,
          v_currency
        ),
        p_action_url => 'withdraw.html',
        p_action_label => 'Voir mon retrait',
        p_entity_type => 'withdrawal_request',
        p_entity_id => NEW.id,
        p_metadata => jsonb_build_object(
          'request_id', NEW.id,
          'amount', NEW.amount,
          'currency', v_currency,
          'method', v_method,
          'status', v_status
        ),
        p_priority => 'normal',
        p_dedup_key => 'withdrawal_submitted:' || NEW.id::text
      );

    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
      IF v_status IN ('approved', 'confirmed') THEN
        PERFORM public.create_system_notification(
          p_recipient_id => NEW.user_id,
          p_type => 'withdrawal_approved',
          p_category => 'withdrawal',
          p_title => 'Retrait approuvé',
          p_message => format(
            'Votre retrait de %s %s a été approuvé.',
            v_amount_text,
            v_currency
          ),
          p_action_url => 'withdraw.html',
          p_action_label => 'Voir mon retrait',
          p_entity_type => 'withdrawal_request',
          p_entity_id => NEW.id,
          p_metadata => jsonb_build_object(
            'request_id', NEW.id,
            'amount', NEW.amount,
            'currency', v_currency,
            'method', v_method,
            'status', v_status
          ),
          p_priority => 'high',
          p_dedup_key => 'withdrawal_approved:' || NEW.id::text
        );

      ELSIF v_status IN ('rejected', 'refused') THEN
        v_message := format(
          'Votre demande de retrait de %s %s a été refusée.',
          v_amount_text,
          v_currency
        );

        IF v_admin_note IS NOT NULL THEN
          v_message := v_message || ' Motif : ' || v_admin_note;
        END IF;

        PERFORM public.create_system_notification(
          p_recipient_id => NEW.user_id,
          p_type => 'withdrawal_rejected',
          p_category => 'withdrawal',
          p_title => 'Retrait refusé',
          p_message => v_message,
          p_action_url => 'withdraw.html',
          p_action_label => 'Voir ma demande',
          p_entity_type => 'withdrawal_request',
          p_entity_id => NEW.id,
          p_metadata => jsonb_build_object(
            'request_id', NEW.id,
            'amount', NEW.amount,
            'currency', v_currency,
            'method', v_method,
            'status', v_status,
            'admin_note', v_admin_note
          ),
          p_priority => 'high',
          p_dedup_key => 'withdrawal_rejected:' || NEW.id::text
        );
      END IF;
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING
        'Erreur lors de la création de la notification pour le retrait % : %',
        NEW.id,
        SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_withdrawal_request_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_withdrawal_request_change() FROM anon;
REVOKE ALL ON FUNCTION public.notify_withdrawal_request_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_notify_withdrawal_request_change
ON public.withdrawal_requests;

CREATE TRIGGER trg_notify_withdrawal_request_change
AFTER INSERT OR UPDATE
ON public.withdrawal_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_withdrawal_request_change();

NOTIFY pgrst, 'reload schema';