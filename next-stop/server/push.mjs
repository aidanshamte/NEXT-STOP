// Push notifications through the Expo Push Service (which relays to APNs / FCM).
// Best effort: a ticket with status "ok" means Expo accepted the message, not that
// a phone displayed it. Messages never contain coordinates or tokens.
export const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export function createExpoTransport({
  accessToken = process.env.EXPO_ACCESS_TOKEN || '',
  fetchImpl = fetch,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
  async function post(url, body) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await wait(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw Error(`Expo push request failed (${response.status}).`);
      return response.json();
    }
  }
  return {
    // messages: [{ to, title, body, data }] → tickets in the same order
    async send(messages) {
      const tickets = [];
      for (let i = 0; i < messages.length; i += 100)
        tickets.push(...((await post(SEND_URL, messages.slice(i, i + 100))).data || []));
      return tickets;
    },
    async receipts(ids) {
      const out = {};
      for (let i = 0; i < ids.length; i += 1000)
        Object.assign(out, (await post(RECEIPTS_URL, { ids: ids.slice(i, i + 1000) })).data || {});
      return out;
    },
  };
}

export function createPush(db, { transport = null, log = null, clock = Date.now } = {}) {
  const forget = (token) => db.prepare('DELETE FROM push_tokens WHERE token=?').run(token);
  const tokensFor = (userIds) => {
    if (!userIds.length) return [];
    const marks = userIds.map(() => '?').join(',');
    return (
      db
        // Only devices whose sign-in session is still valid (reset, expiry and sign-out end it).
        .prepare(
          `SELECT p.token FROM push_tokens p JOIN sessions s ON s.token_hash=p.session_hash WHERE p.user_id IN (${marks}) AND s.expires_at>?`,
        )
        .all(...userIds, clock())
        .map((r) => r.token)
    );
  };
  async function deliver(notes) {
    if (!transport) return;
    const messages = [];
    for (const { userIds, title, body, data } of notes)
      for (const token of tokensFor([...new Set(userIds)]))
        messages.push({
          to: token,
          title,
          body,
          data: data || {},
          sound: 'default',
          channelId: 'trip-updates',
          priority: 'high',
        });
    if (!messages.length) return;
    try {
      const tickets = await transport.send(messages);
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'ok' && ticket.id)
          db.prepare('INSERT OR IGNORE INTO push_tickets VALUES (?,?,?)').run(
            ticket.id,
            messages[i].to,
            clock(),
          );
        else if (ticket?.details?.error === 'DeviceNotRegistered') forget(messages[i].to);
        else if (ticket?.status === 'error')
          log?.({ level: 'error', event: 'push_ticket_error', code: ticket.details?.error });
      });
      log?.({ level: 'info', event: 'push_sent', count: messages.length });
    } catch (error) {
      log?.({ level: 'error', event: 'push_failed', message: String(error.message).slice(0, 200) });
    }
  }
  return {
    register(uid, sessionHash, token, platform) {
      db.prepare(
        'INSERT INTO push_tokens VALUES (?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash,platform=excluded.platform,created_at=excluded.created_at',
      ).run(token, uid, sessionHash, platform, clock());
    },
    unregister(uid, token) {
      db.prepare('DELETE FROM push_tokens WHERE token=? AND user_id=?').run(token, uid);
    },
    // Fire-and-forget: never delays or fails the API response that triggered it.
    notify(notes) {
      if (transport && notes.length) queueMicrotask(() => void deliver(notes));
    },
    deliver,
    // Checks receipts for tickets older than 15 minutes; removes unregistered devices.
    async checkReceipts() {
      if (!transport) return;
      const due = db
        .prepare('SELECT id,token FROM push_tickets WHERE created_at<=?')
        .all(clock() - 15 * 60000);
      if (!due.length) return;
      try {
        const receipts = await transport.receipts(due.map((t) => t.id));
        for (const ticket of due) {
          const receipt = receipts[ticket.id];
          if (receipt?.details?.error === 'DeviceNotRegistered') forget(ticket.token);
          else if (receipt?.status === 'error')
            log?.({ level: 'error', event: 'push_receipt_error', code: receipt.details?.error });
        }
        const done = db.prepare('DELETE FROM push_tickets WHERE id=?');
        for (const ticket of due) done.run(ticket.id);
      } catch (error) {
        log?.({
          level: 'error',
          event: 'push_receipts_failed',
          message: String(error.message).slice(0, 200),
        });
      }
    },
  };
}
