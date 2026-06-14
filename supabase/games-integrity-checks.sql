-- Vérifications manuelles de cohérence des jeux Borlette / Mariage.
-- Ce fichier est en lecture seule : il ne modifie rien.

-- 1) Tickets Borlette sans draw_name
SELECT
  t.id,
  t.ticket_number,
  t.user_id,
  t.game_type,
  t.draw_name,
  t.status,
  t.created_at
FROM tickets t
WHERE t.game_type = 'borlette'
  AND (t.draw_name IS NULL OR t.draw_name = '');

-- 2) Tickets Mariage sans draw_name
SELECT
  t.id,
  t.ticket_number,
  t.user_id,
  t.game_type,
  t.draw_name,
  t.status,
  t.created_at
FROM tickets t
WHERE t.game_type = 'mariage'
  AND (t.draw_name IS NULL OR t.draw_name = '');

-- 3) Tickets avec game_type invalide
SELECT
  t.id,
  t.ticket_number,
  t.user_id,
  t.game_type,
  t.draw_name,
  t.status
FROM tickets t
WHERE t.game_type NOT IN ('borlette', 'mariage');

-- 4) Ticket items sans number_played
SELECT
  ti.id,
  ti.ticket_id,
  ti.number_played,
  ti.amount,
  ti.status
FROM ticket_items ti
WHERE ti.number_played IS NULL
   OR trim(coalesce(ti.number_played, '')) = '';

-- 5) Résultats Borlette sans les 3 lots attendus
SELECT
  dr.id,
  dr.draw_name,
  dr.game_type,
  dr.first_prize_number,
  dr.second_prize_number,
  dr.third_prize_number,
  dr.status
FROM draw_results dr
WHERE dr.game_type = 'borlette'
  AND (
    dr.first_prize_number IS NULL
    OR dr.second_prize_number IS NULL
    OR dr.third_prize_number IS NULL
    OR trim(coalesce(dr.first_prize_number, '')) = ''
    OR trim(coalesce(dr.second_prize_number, '')) = ''
    OR trim(coalesce(dr.third_prize_number, '')) = ''
  );

-- 6) Transactions avec référence dupliquée
SELECT
  tr.reference,
  count(*) AS occurrences
FROM transactions tr
GROUP BY tr.reference
HAVING count(*) > 1;

-- 7) Tickets pending avec résultat publié correspondant
SELECT
  t.id,
  t.ticket_number,
  t.user_id,
  t.game_type,
  t.draw_name,
  t.status,
  dr.id AS draw_result_id,
  dr.status AS draw_result_status
FROM tickets t
JOIN draw_results dr
  ON dr.draw_name = t.draw_name
 AND dr.game_type = t.game_type
WHERE t.status = 'pending'
  AND dr.status = 'published';
