DROP POLICY IF EXISTS transactions_block_client_insert ON public.transactions;

CREATE POLICY transactions_block_client_insert
ON public.transactions
FOR INSERT
WITH CHECK (false);