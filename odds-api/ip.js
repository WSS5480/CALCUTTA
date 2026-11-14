// The real client address. On Render the X-Forwarded-For chain is "client, Cloudflare edge, Render proxy" (checked live 2026-11-13),
// so the client is the THIRD from the end. The last entry is Render's own proxy: using it put every visitor in one shared bucket.
// Counting from the end also ignores anything a visitor adds to the front of the header.
exports.clientIp = (req) => {
  const p = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (p.length >= 3) return p[p.length - 3];
  return p[p.length - 1] || req.socket.remoteAddress || ''; // short chain = not through Cloudflare: never trust the first (client-supplied) entry
};
