(function (global) {
  'use strict';

  if (global.__tkTraditionalGamesSecureInstalled) return;
  global.__tkTraditionalGamesSecureInstalled = true;

  const pathname = String(global.location?.pathname || '')
    .replace(/\\/g, '/')
    .toLowerCase();
  const pageName = pathname.split('/').filter(Boolean).pop() || '';
  const isAdminPage = pathname.includes('/admin/');

  const GAMES = Object.freeze({
    'borlette.html': {
      gameType: 'borlette',
      rpc: 'play_borlette',
      label: 'Borlette',
      numberPattern: /\b(\d{1,2})\b/,
      normalizeNumber: (value) => String(value).padStart(2, '0'),
      requiresOption: false,
    },
    'mariage.html': {
      gameType: 'mariage',
      rpc: 'play_mariage',
      label: 'Mariage',
      numberPattern: /\b(\d{1,2}-\d{1,2})\b/,
      normalizeNumber: (value) => value
        .split('-')
        .map((part) => String(part).padStart(2, '0'))
        .join('-'),
      requiresOption: false,
    },
    'lotto3.html': {
      gameType: 'lotto3',
      rpc: 'play_lotto3',
      label: 'Lotto 3',
      numberPattern: /\b(\d{1,3})\b/,
      normalizeNumber: (value) => String(value).padStart(3, '0'),
      requiresOption: false,
    },
    'lotto4.html': {
      gameType: 'lotto4',
      rpc: 'play_lotto4',
      label: 'Lotto 4',
      numberPattern: /\b(\d{1,4})\b/,
      normalizeNumber: (value) => String(value).padStart(4, '0'),
      requiresOption: true,
    },
    'lotto5.html': {
      gameType: 'lotto5',
      rpc: 'play_lotto5',
      label: 'Lotto 5',
      numberPattern: /\b(\d{1,5})\b/,
      normalizeNumber: (value) => String(value).padStart(5, '0'),
      requiresOption: true,
    },
  });

  const currentGame = pathname.includes('/jeux/') ? GAMES[pageName] || null : null;
  const shouldRenderAdminRisk = isAdminPage
    && ['dashboard.html', 'results.html', 'index.html'].includes(pageName);

  if (!currentGame && !shouldRenderAdminRisk) return;

  const MIN_LINE_BET = 20;
  const REQUEST_STORAGE_PREFIX = 'tk:traditional-game-request:';
  let submissionInProgress = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function addSharedStyles() {
    if (!global.document?.head) return;
    if (global.document.getElementById('tk-traditional-security-styles')) return;

    const style = global.document.createElement('style');
    style.id = 'tk-traditional-security-styles';
    style.textContent = `
      .tk-risk-admin {
        margin: 18px 0;
        padding: 18px;
        border: 1px solid rgba(255, 210, 31, .24);
        border-radius: 22px;
        background: linear-gradient(180deg, rgba(8, 24, 43, .98), rgba(5, 17, 31, .98));
        box-shadow: 0 20px 48px rgba(0, 0, 0, .34);
        color: #f5f7fb;
      }
      .tk-risk-admin__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .tk-risk-admin h2,
      .tk-risk-admin h3 { margin: 0; }
      .tk-risk-admin p { color: #aebbd0; }
      .tk-risk-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .tk-risk-card {
        min-width: 0;
        padding: 12px;
        border: 1px solid rgba(255, 255, 255, .1);
        border-radius: 16px;
        background: rgba(255, 255, 255, .035);
      }
      .tk-risk-card span {
        display: block;
        color: #aebbd0;
        font-size: 12px;
      }
      .tk-risk-card strong {
        display: block;
        margin-top: 5px;
        color: #fff;
        font-size: 18px;
        overflow-wrap: anywhere;
      }
      .tk-risk-level {
        display: inline-flex;
        align-items: center;
        padding: 7px 10px;
        border: 1px solid rgba(255, 255, 255, .12);
        border-radius: 999px;
        font-size: 12px;
        font-weight: 900;
      }
      .tk-risk-level--available {
        color: #dfffea;
        background: rgba(70, 227, 111, .1);
        border-color: rgba(70, 227, 111, .22);
      }
      .tk-risk-level--watch {
        color: #fff7d7;
        background: rgba(255, 210, 31, .1);
        border-color: rgba(255, 210, 31, .25);
      }
      .tk-risk-level--high {
        color: #ffe9cc;
        background: rgba(255, 153, 51, .12);
        border-color: rgba(255, 153, 51, .28);
      }
      .tk-risk-level--full {
        color: #ffe1e5;
        background: rgba(255, 93, 108, .12);
        border-color: rgba(255, 93, 108, .28);
      }
      .tk-risk-table-wrap {
        margin-top: 14px;
        overflow-x: auto;
        border: 1px solid rgba(255, 255, 255, .1);
        border-radius: 16px;
      }
      .tk-risk-table {
        width: 100%;
        min-width: 760px;
        border-collapse: collapse;
      }
      .tk-risk-table th,
      .tk-risk-table td {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, .08);
        text-align: left;
        vertical-align: top;
      }
      .tk-risk-table th {
        color: #aebbd0;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .09em;
      }
      .tk-risk-table td {
        color: #edf4ff;
        font-size: 13px;
      }
      .tk-risk-positions {
        display: grid;
        gap: 8px;
        margin-top: 14px;
      }
      .tk-risk-position {
        padding: 10px 12px;
        border: 1px solid rgba(255, 255, 255, .09);
        border-radius: 14px;
        background: rgba(255, 255, 255, .025);
      }
      .tk-risk-position strong { color: #ffd21f; }
      .tk-risk-explanation {
        margin-top: 14px;
        padding: 10px 12px;
        border-left: 4px solid #ffd21f;
        border-radius: 10px;
        background: rgba(255, 210, 31, .07);
        color: #fff7da;
      }
      .tk-risk-empty {
        padding: 12px 0;
        color: #aebbd0;
      }
      @media (max-width: 1080px) {
        .tk-risk-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 620px) {
        .tk-risk-admin {
          padding: 14px;
          border-radius: 18px;
        }
        .tk-risk-grid { grid-template-columns: 1fr; }
        .tk-risk-card strong { font-size: 16px; }
      }
      @media (max-width: 360px) {
        .tk-risk-admin {
          margin-left: -4px;
          margin-right: -4px;
          padding: 12px;
        }
      }
      @media (min-width: 1500px) {
        .tk-risk-admin {
          max-width: 1380px;
          margin-left: auto;
          margin-right: auto;
        }
      }
    `;
    global.document.head.appendChild(style);
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString(
      global.TKI18n?.getLocale?.() || 'fr-FR',
      {
        minimumFractionDigits: Number(value || 0) % 1 ? 2 : 0,
        maximumFractionDigits: 2,
      }
    )} HTG`;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString(
        global.TKI18n?.getLocale?.() || 'fr-FR'
      );
    } catch {
      return String(value);
    }
  }

  function getHaitiDateISO(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Port-au-Prince',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
  }

  function parseMoney(text) {
    let normalized = String(text || '')
      .replace(/HTG/gi, '')
      .replace(/[\s\u00a0\u202f]/g, '')
      .replace(/[^0-9,.-]/g, '');

    if (normalized.includes(',') && normalized.includes('.')) {
      if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = normalized.replace(/,/g, '');
      }
    } else if (normalized.includes(',')) {
      normalized = normalized.replace(',', '.');
    }

    return Number(normalized);
  }

  function setFeedback(message, type = 'warn') {
    const box = global.document?.getElementById('feedback-box');
    if (!box) return;

    box.textContent = message;
    box.className = 'feedback';

    if (type === 'success') box.classList.add('success');
    if (type === 'error') box.classList.add('error');
    if (type === 'warn') box.classList.add('warn');
  }

  function createRequestId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();

    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  function getRequestStorageKey(gameType) {
    return `${REQUEST_STORAGE_PREFIX}${gameType}`;
  }

  function getStableRequestId(gameType, fingerprint) {
    const key = getRequestStorageKey(gameType);

    try {
      const stored = JSON.parse(global.sessionStorage.getItem(key) || 'null');
      if (stored?.fingerprint === fingerprint && stored?.requestId) {
        return stored.requestId;
      }
    } catch {
      // Ignore malformed or unavailable browser storage.
    }

    const requestId = createRequestId();

    try {
      global.sessionStorage.setItem(
        key,
        JSON.stringify({
          requestId,
          fingerprint,
          createdAt: Date.now(),
        })
      );
    } catch {
      // The request ID still protects this individual request.
    }

    return requestId;
  }

  function clearStableRequestId(gameType) {
    try {
      global.sessionStorage.removeItem(getRequestStorageKey(gameType));
    } catch {
      // Ignore unavailable browser storage.
    }
  }

  function stableFingerprint(gameType, drawName, drawDate, items) {
    const normalizedItems = [...items]
      .map((item) => ({
        number_played: String(item.number_played),
        amount: Number(item.amount),
        option_type: item.option_type || null,
      }))
      .sort((left, right) => (
        left.number_played.localeCompare(right.number_played)
        || String(left.option_type || '').localeCompare(String(right.option_type || ''))
        || left.amount - right.amount
      ));

    return JSON.stringify({
      gameType,
      drawName,
      drawDate,
      items: normalizedItems,
    });
  }

  function extractOptionType(source) {
    const match = String(source || '').match(/\boption\s*([123])\b/i);
    return match ? `option${match[1]}` : null;
  }

  function collectCouponItems(game) {
    const items = [];
    const couponItems = Array.from(
      global.document?.querySelectorAll('#coupon-list .coupon-item') || []
    );

    couponItems.forEach((item) => {
      const primarySource = item.querySelector('.coupon-left strong')?.textContent
        || item.querySelector('strong')?.textContent
        || item.textContent
        || '';

      const numberMatch = String(primarySource).match(game.numberPattern);
      if (!numberMatch) return;

      const explicitAmount = item.querySelector('.coupon-amount')?.textContent;
      const amountSource = explicitAmount
        || Array.from(item.querySelectorAll('strong'))
          .map((node) => node.textContent || '')
          .find((text) => /HTG/i.test(text))
        || item.textContent
        || '';

      const amount = parseMoney(amountSource);
      if (!Number.isFinite(amount) || amount <= 0) return;

      const optionType = game.requiresOption
        ? (
          item.dataset.optionType
          || extractOptionType(primarySource)
          || extractOptionType(item.textContent)
        )
        : null;

      const normalizedItem = {
        number_played: game.normalizeNumber(numberMatch[1]),
        amount,
      };

      if (optionType) normalizedItem.option_type = optionType;
      items.push(normalizedItem);
    });

    return items;
  }

  function clearCouponThroughExistingUi() {
    const buttons = Array.from(
      global.document?.querySelectorAll(
        '#coupon-list button[data-delete], #coupon-list .btn-danger'
      ) || []
    );

    buttons.forEach((button) => button.click());
  }

  function isNetworkError(error) {
    if (global.navigator && global.navigator.onLine === false) return true;

    const message = String(
      error?.message || error?.details || error || ''
    );

    return /failed to fetch|networkerror|network request|load failed|fetch failed|connection/i
      .test(message);
  }

  function shouldPreserveRequestId(error) {
    if (isNetworkError(error)) return true;

    const code = String(error?.code || error?.status || '').toUpperCase();
    const message = String(
      error?.message || error?.details || error || ''
    );

    return code === '55P03'
      || code === '57014'
      || /^08/.test(code)
      || /déjà en cours|already in progress|timeout|timed out|gateway|temporarily unavailable|service unavailable|502|503|504/i
        .test(message);
  }

  function businessErrorMessage(source) {
    const message = String(
      source?.reason || source?.message || source || ''
    ).trim();

    if (/ferm|closed|clôtur|tirage.*pass/i.test(message)) {
      return 'Les mises sont fermées pour ce tirage.';
    }
    if (/solde|insufficient|balance/i.test(message)) {
      return 'Le solde est insuffisant.';
    }
    if (/minimum|20\s*HTG|min_line|inférieur|montant.*autorisé/i.test(message)) {
      return 'Le montant minimum est de 20 HTG par ligne.';
    }
    if (/réserve|reserve|fonds|exposition|exposure|risque|dépass/i.test(message)) {
      return 'Cette mise dépasserait le fonds disponible pour payer les gagnants.';
    }
    if (/tirage actif introuvable|horaire.*non configuré/i.test(message)) {
      return 'Ce tirage n’est pas correctement configuré.';
    }
    if (/jeu.*indisponible|not enabled|disabled/i.test(message)) {
      return 'Le jeu doit être activé côté serveur avant la validation.';
    }

    return message || 'Impossible de valider cette mise pour le moment.';
  }

  async function waitForDependencies(maxAttempts = 40, delay = 150) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const client = global.supabaseClient || null;
      const getUser = global.getCurrentUserAsync;

      if (client?.rpc && typeof getUser === 'function') {
        return { client, getUser };
      }

      await new Promise((resolve) => global.setTimeout(resolve, delay));
    }

    return {
      client: global.supabaseClient || null,
      getUser: global.getCurrentUserAsync || null,
    };
  }

  function validateMinimumBeforeAdding(event) {
    if (!currentGame) return;

    const amountInput = global.document?.getElementById('amount-input');
    const amount = Number(amountInput?.value);

    if (Number.isFinite(amount) && amount >= MIN_LINE_BET) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    setFeedback('Le montant minimum est de 20 HTG par ligne.', 'warn');
    amountInput?.focus();
  }

  function validateCollectedItems(items) {
    if (!items.length) {
      return 'Ajoutez au moins une ligne valide au coupon avant de continuer.';
    }

    if (items.some((item) => (
      !Number.isFinite(item.amount) || item.amount < MIN_LINE_BET
    ))) {
      return 'Le montant minimum est de 20 HTG par ligne.';
    }

    if (
      currentGame.requiresOption
      && items.some((item) => !/^option[123]$/.test(item.option_type || ''))
    ) {
      return 'Chaque ligne doit contenir une option Lotto valide.';
    }

    return null;
  }

  async function submitSecureTicket() {
    if (!currentGame || submissionInProgress) return;

    const validateButton = global.document?.getElementById('validate-btn');
    const drawName = String(
      global.document?.getElementById('draw-name-select')?.value || ''
    ).trim();
    const items = collectCouponItems(currentGame);

    if (!drawName) {
      setFeedback('Choisissez un tirage avant de valider le ticket.', 'warn');
      return;
    }

    const validationError = validateCollectedItems(items);
    if (validationError) {
      setFeedback(validationError, 'warn');
      return;
    }

    const drawDate = getHaitiDateISO();
    const fingerprint = stableFingerprint(
      currentGame.gameType,
      drawName,
      drawDate,
      items
    );
    const requestId = getStableRequestId(
      currentGame.gameType,
      fingerprint
    );
    const totalAmount = items.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    submissionInProgress = true;

    if (validateButton) {
      validateButton.disabled = true;
      validateButton.setAttribute('aria-busy', 'true');
      validateButton.dataset.originalLabel = (
        validateButton.dataset.originalLabel
        || validateButton.textContent
        || 'Valider le ticket'
      );
      validateButton.textContent = 'Validation sécurisée…';
    }

    setFeedback('Validation sécurisée de la mise en cours…', 'warn');

    try {
      const { client, getUser } = await waitForDependencies();

      if (!client?.rpc || typeof getUser !== 'function') {
        throw new Error('Connexion au service momentanément indisponible.');
      }

      const user = await getUser();
      const userId = user?.id || user?.user_id || null;

      if (!userId) {
        clearStableRequestId(currentGame.gameType);
        setFeedback(
          'Vous devez être connecté pour valider un ticket.',
          'warn'
        );
        return;
      }

      const { data, error } = await client.rpc(currentGame.rpc, {
        p_user_id: userId,
        p_draw_name: drawName,
        p_draw_date: drawDate,
        p_items: items,
        p_request_id: requestId,
      });

      if (error) throw error;

      const response = (
        Array.isArray(data) && data.length === 1 ? data[0] : data
      );

      if (!response || response.success !== true) {
        clearStableRequestId(currentGame.gameType);
        setFeedback(businessErrorMessage(response), 'error');
        return;
      }

      clearStableRequestId(currentGame.gameType);
      clearCouponThroughExistingUi();

      const ticketNumber = (
        response.ticket_number
        || response.ticketNumber
        || 'confirmé'
      );

      setFeedback(
        `Ticket ${currentGame.label} validé : ${ticketNumber}. `
          + `Débit confirmé de ${formatMoney(
            response.total_amount ?? totalAmount
          )}.`,
        'success'
      );

      global.dispatchEvent(
        new CustomEvent('tonton:wallet-updated', {
          detail: {
            source: currentGame.gameType,
            transactionType: 'bet',
            amount: response.total_amount ?? totalAmount,
            ticketNumber,
            requestId,
          },
        })
      );

      if (typeof global.refreshGameHeaderBalance === 'function') {
        await global.refreshGameHeaderBalance();
      } else if (
        typeof global.refreshAuthHeaderBalance === 'function'
      ) {
        await global.refreshAuthHeaderBalance();
      }
    } catch (error) {
      if (shouldPreserveRequestId(error)) {
        const isStillProcessing = (
          String(error?.code || '').toUpperCase() === '55P03'
          || /déjà en cours|already in progress/i.test(
            String(error?.message || error || '')
          )
        );

        setFeedback(
          isStillProcessing
            ? 'La première demande est encore en cours. Réessayez dans quelques secondes : la même référence sera conservée pour empêcher un double débit.'
            : 'La réponse du serveur est incertaine. Réessayez : la même référence sera conservée pour empêcher un double débit.',
          'warn'
        );
      } else {
        clearStableRequestId(currentGame.gameType);
        setFeedback(businessErrorMessage(error), 'error');
      }

      console.error(
        `Validation sécurisée ${currentGame.label} :`,
        error
      );
    } finally {
      submissionInProgress = false;

      if (validateButton) {
        validateButton.disabled = false;
        validateButton.removeAttribute('aria-busy');
        validateButton.textContent = (
          validateButton.dataset.originalLabel
          || 'Valider le ticket'
        );
      }
    }
  }

  function interceptGameEvents() {
    if (!currentGame || !global.document) return;

    global.document.addEventListener(
      'click',
      (event) => {
        const validateButton = event.target?.closest?.('#validate-btn');

        if (validateButton) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          submitSecureTicket();
          return;
        }

        const addLineButton = event.target?.closest?.('#add-line-btn');
        if (addLineButton) validateMinimumBeforeAdding(event);
      },
      true
    );

    global.document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key !== 'Enter'
          || event.target?.id !== 'amount-input'
        ) {
          return;
        }

        const amount = Number(event.target.value);
        if (
          Number.isFinite(amount)
          && amount >= MIN_LINE_BET
        ) {
          return;
        }

        validateMinimumBeforeAdding(event);
      },
      true
    );
  }

  function riskLevelClass(percent) {
    const value = Number(percent || 0);

    if (value >= 100) return 'tk-risk-level--full';
    if (value >= 90) return 'tk-risk-level--high';
    if (value >= 80) return 'tk-risk-level--watch';

    return 'tk-risk-level--available';
  }

  function riskLevelLabel(percent, backendLabel) {
    if (backendLabel) return backendLabel;

    const value = Number(percent || 0);

    if (value >= 100) return 'Limite atteinte';
    if (value >= 90) return 'Risque élevé';
    if (value >= 80) return 'Vigilance';

    return 'Réserve disponible';
  }

  function renderPositions(positions) {
    const list = Array.isArray(positions) ? positions.slice(0, 15) : [];

    if (!list.length) {
      return '<div class="tk-risk-empty">Aucun numéro proche de la limite pour le moment.</div>';
    }

    return `<div class="tk-risk-positions">${list.map((position) => {
      const number = escapeHtml(
        position['numéro']
        || position.numero
        || position.number
        || '—'
      );
      const game = escapeHtml(position.jeu || 'Jeu');
      const payment = (
        position['paiement maximal']
        ?? position['paiement si premier lot']
        ?? position.paiement_possible
        ?? 0
      );
      const percent = (
        position['pourcentage de la réserve']
        ?? position.percentage
        ?? 0
      );

      return `
        <article class="tk-risk-position">
          <strong>${game} — numéro ${number}</strong><br>
          Paiement maximal observé : ${formatMoney(payment)}
          · Part du fonds : ${Number(percent || 0).toFixed(1)} %
        </article>
      `;
    }).join('')}</div>`;
  }

  function renderRiskAdmin(registers, rejections) {
    global.document.getElementById('tk-risk-admin')?.remove();

    const container = global.document.createElement('section');
    container.id = 'tk-risk-admin';
    container.className = 'tk-risk-admin';

    const normalizedRegisters = Array.isArray(registers) ? registers : [];
    const normalizedRejections = Array.isArray(rejections) ? rejections : [];

    const highestRisk = [...normalizedRegisters].sort(
      (left, right) => (
        Number(right.reserve_used_percent || 0)
        - Number(left.reserve_used_percent || 0)
      )
    )[0] || null;

    const reserve = Number(highestRisk?.reserve_amount ?? 0);
    const engaged = Number(highestRisk?.risk_engaged ?? 0);
    const remaining = Number(
      highestRisk?.risk_remaining ?? reserve
    );
    const usedPercent = Number(
      highestRisk?.reserve_used_percent ?? 0
    );
    const level = riskLevelLabel(
      usedPercent,
      highestRisk?.risk_level
    );

    const registerRows = normalizedRegisters.length
      ? normalizedRegisters.map((row) => `
          <tr>
            <td>${escapeHtml(row.draw_name || 'Tirage')}</td>
            <td>${escapeHtml(row.draw_date || '—')}</td>
            <td>${formatMoney(row.risk_engaged)}</td>
            <td>${formatMoney(row.risk_remaining)}</td>
            <td>${Number(
              row.reserve_used_percent || 0
            ).toFixed(1)} %</td>
            <td>
              <span class="tk-risk-level ${riskLevelClass(
                row.reserve_used_percent
              )}">
                ${escapeHtml(
                  riskLevelLabel(
                    row.reserve_used_percent,
                    row.risk_level
                  )
                )}
              </span>
            </td>
          </tr>
        `).join('')
      : '<tr><td colspan="6">Aucun risque engagé.</td></tr>';

    const rejectionRows = normalizedRejections.length
      ? normalizedRejections.map((row) => `
          <tr>
            <td>${formatDate(row.created_at)}</td>
            <td>${escapeHtml(row.game_type || 'Jeu')}</td>
            <td>${escapeHtml(row.draw_name || '—')}</td>
            <td>${formatMoney(row.requested_amount)}</td>
            <td>${formatMoney(row.exceeded_by)}</td>
            <td>${escapeHtml(
              row.reason
              || 'Le fonds disponible aurait été dépassé.'
            )}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="6">Aucune mise refusée pour dépassement du fonds.</td></tr>';

    container.innerHTML = `
      <div class="tk-risk-admin__head">
        <div>
          <h2>Protection du fonds des gagnants</h2>
          <p>
            Risque maximal engagé par les jeux traditionnels,
            sans masquer ni désactiver les jeux.
          </p>
        </div>
        <span class="tk-risk-level ${riskLevelClass(usedPercent)}">
          ${escapeHtml(level)}
        </span>
      </div>

      <div class="tk-risk-grid">
        <article class="tk-risk-card">
          <span>Fonds de réserve</span>
          <strong>${formatMoney(reserve)}</strong>
        </article>
        <article class="tk-risk-card">
          <span>Risque déjà engagé</span>
          <strong>${formatMoney(engaged)}</strong>
        </article>
        <article class="tk-risk-card">
          <span>Risque encore disponible</span>
          <strong>${formatMoney(remaining)}</strong>
        </article>
        <article class="tk-risk-card">
          <span>Pourcentage utilisé</span>
          <strong>${usedPercent.toFixed(1)} %</strong>
        </article>
      </div>

      <div class="tk-risk-explanation">
        Les jeux restent accessibles. Une mise est refusée uniquement
        lorsque son paiement maximal dépasserait la réserve configurée.
      </div>

      <h3 style="margin-top:18px;">Situation par tirage</h3>
      <div class="tk-risk-table-wrap">
        <table class="tk-risk-table">
          <thead>
            <tr>
              <th>Tirage</th>
              <th>Date</th>
              <th>Risque engagé</th>
              <th>Risque restant</th>
              <th>Utilisation</th>
              <th>Niveau</th>
            </tr>
          </thead>
          <tbody>${registerRows}</tbody>
        </table>
      </div>

      <h3 style="margin-top:18px;">Numéros surveillés</h3>
      ${renderPositions(highestRisk?.positions)}

      <h3 style="margin-top:18px;">Historique des mises refusées</h3>
      <div class="tk-risk-table-wrap">
        <table class="tk-risk-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Jeu</th>
              <th>Tirage</th>
              <th>Mise</th>
              <th>Dépassement</th>
              <th>Raison</th>
            </tr>
          </thead>
          <tbody>${rejectionRows}</tbody>
        </table>
      </div>
    `;

    const anchor = global.document.querySelector(
      '.hero-card, .hero, main > section, main'
    );

    if (
      anchor?.parentNode
      && anchor !== global.document.querySelector('main')
    ) {
      anchor.parentNode.insertBefore(container, anchor.nextSibling);
    } else {
      (
        global.document.querySelector('main')
        || global.document.body
      ).prepend(container);
    }
  }

  async function loadAdminRisk() {
    if (!shouldRenderAdminRisk) return;

    addSharedStyles();

    try {
      const { client } = await waitForDependencies();

      if (!client?.from) {
        throw new Error('Connexion au service indisponible.');
      }

      const [registerResult, rejectionResult] = await Promise.all([
        client
          .from('draw_risk_register')
          .select(
            'risk_group, draw_name, draw_date, reserve_amount, '
              + 'risk_engaged, risk_remaining, reserve_used_percent, '
              + 'risk_level, positions, updated_at'
          )
          .order('draw_date', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(30),
        client
          .from('draw_risk_rejections')
          .select(
            'id, game_type, draw_name, draw_date, requested_amount, '
              + 'risk_before, risk_after, reserve_amount, exceeded_by, '
              + 'reason, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      if (registerResult.error) throw registerResult.error;
      if (rejectionResult.error) throw rejectionResult.error;

      renderRiskAdmin(
        registerResult.data || [],
        rejectionResult.data || []
      );
    } catch (error) {
      console.warn(
        'Affichage administratif du risque indisponible :',
        error
      );

      renderRiskAdmin([], []);

      const container = global.document.getElementById(
        'tk-risk-admin'
      );
      const note = global.document.createElement('p');

      note.className = 'tk-risk-empty';
      note.textContent = (
        'Les informations de risque ne sont pas accessibles avec '
        + 'cette session. Connectez-vous avec un compte administrateur.'
      );

      container?.appendChild(note);
    }
  }

  addSharedStyles();
  interceptGameEvents();

  if (global.document.readyState === 'loading') {
    global.document.addEventListener(
      'DOMContentLoaded',
      loadAdminRisk,
      { once: true }
    );
  } else {
    loadAdminRisk();
  }
})(window);
