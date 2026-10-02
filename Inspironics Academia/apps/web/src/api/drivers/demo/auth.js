import { currentUser, currentUserRow, db, persist, publicUser } from '@/api/drivers/demo/store';
import { badRequest, forbidden, newId, nowIso, unauthorized } from '@/api/drivers/demo/records';

// Demo auth: the "session" is the signed-in user id stored with the demo database.
// Seeded accounts (admin@demo.local, learner@demo.local) accept any non-empty password.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const tick = () => new Promise((resolve) => { setTimeout(resolve, 120); });

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 256) return 'Password is too long';
  return null;
}

const randomPassword = () => (newId().replace(/-/g, '').slice(0, 12));
const findByEmail = (email) => db().users.find((u) => u.email === cleanEmail(email));

function recordLogin(user, email, success, reason) {
  const s = db();
  s.logins.unshift({ id: newId(), user_id: user?.id || null, email, success, reason, ip: '127.0.0.1', user_agent: navigator.userAgent, created_date: nowIso() });
  s.logins = s.logins.slice(0, 500);
}

function passwordMatches(user, password) {
  if (typeof password !== 'string' || !password.length) return false;
  return user.any_password ? true : user.password === password;
}

function requireUser() {
  const row = currentUserRow();
  if (!row) throw unauthorized();
  return row;
}

export function createAuth() {
  return {
    async me() { await tick(); return publicUser(requireUser()); },

    async loginViaEmailPassword(email, password) {
      await tick();
      const user = findByEmail(email);
      const ok = !!user && !user.disabled && passwordMatches(user, password);
      recordLogin(user, cleanEmail(email), ok, ok ? 'password' : 'invalid_credentials');
      if (!ok) { persist(); throw unauthorized('Invalid email or password'); }
      user.last_login_at = nowIso();
      db().sessionUserId = user.id;
      persist();
      return { user: publicUser(user) };
    },

    async register({ email, password, full_name: fullName } = {}) {
      await tick();
      const clean = cleanEmail(email);
      if (!EMAIL_RE.test(clean)) throw badRequest('Enter a valid email address');
      const err = validatePassword(password);
      if (err) throw badRequest(err);
      if (findByEmail(clean)) throw badRequest('An account with this email already exists');
      const at = nowIso();
      const role = db().users.length === 0 ? 'admin' : 'user';
      const user = { id: newId(), email: clean, full_name: String(fullName || '').trim(), role, disabled: false, created_date: at, updated_date: at, last_login_at: at, password };
      db().users.push(user);
      db().sessionUserId = user.id;
      recordLogin(user, clean, true, 'register');
      persist();
      return { user: publicUser(user) };
    },

    async logout(redirectUrl) {
      db().sessionUserId = null;
      persist();
      if (redirectUrl) window.location.href = redirectUrl;
    },

    async updateMe(data = {}) {
      await tick();
      const row = requireUser();
      if (data.full_name === undefined && data.avatar_url === undefined) throw badRequest('Nothing to update');
      if (data.full_name !== undefined) {
        if (typeof data.full_name !== 'string' || data.full_name.length > 200) throw badRequest('full_name must be a string');
        row.full_name = data.full_name.trim();
      }
      if (data.avatar_url !== undefined) {
        const ok = typeof data.avatar_url === 'string' && (!data.avatar_url
          || (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.avatar_url) && data.avatar_url.length <= 200_000));
        if (!ok) throw badRequest('avatar_url must be a PNG, JPEG or WebP image under 150 KB');
        row.avatar_url = data.avatar_url;
      }
      row.updated_date = nowIso();
      persist();
      return publicUser(row);
    },

    async changePassword({ currentPassword, newPassword } = {}) {
      await tick();
      const row = requireUser();
      if (!passwordMatches(row, currentPassword)) throw badRequest('Current password is incorrect');
      const err = validatePassword(newPassword);
      if (err) throw badRequest(err);
      Object.assign(row, { password: newPassword, any_password: false, updated_date: nowIso() });
      persist();
      return { ok: true };
    },

    // Like the API (which logs the link server-side), the demo writes the reset link to the console.
    async resetPasswordRequest(email) {
      await tick();
      const user = findByEmail(email);
      if (user) {
        const token = newId();
        db().resets[token] = { user_id: user.id, expires_at: Date.now() + 3600_000 };
        persist();
        console.info(`[demo] password reset link for ${user.email}: ${window.location.origin}/reset-password?token=${token}`);
      }
      return { ok: true };
    },

    async resetPassword({ resetToken, newPassword } = {}) {
      await tick();
      if (!resetToken) throw badRequest('Missing reset token');
      const entry = db().resets[resetToken];
      if (!entry || entry.expires_at < Date.now()) throw badRequest('This reset link is invalid or has expired');
      const err = validatePassword(newPassword);
      if (err) throw badRequest(err);
      const user = db().users.find((u) => u.id === entry.user_id);
      if (user) Object.assign(user, { password: newPassword, any_password: false, updated_date: nowIso() });
      delete db().resets[resetToken];
      persist();
      return { ok: true };
    },

    async inviteUser(email, role, fullName) {
      await tick();
      if (currentUser()?.role !== 'admin') throw forbidden('Administrator access required');
      const clean = cleanEmail(email);
      if (!EMAIL_RE.test(clean)) throw badRequest('Enter a valid email address');
      if (findByEmail(clean)) throw badRequest('A user with this email already exists');
      const temporaryPassword = randomPassword();
      const at = nowIso();
      const user = {
        id: newId(), email: clean, full_name: String(fullName || '').trim(), role: role === 'admin' ? 'admin' : 'user',
        disabled: false, created_date: at, updated_date: at, last_login_at: null, password: temporaryPassword,
      };
      db().users.push(user);
      persist();
      return { user: publicUser(user), temporary_password: temporaryPassword };
    },

    async loginHistory({ limit = 100, user_id: userId } = {}) {
      await tick();
      const me = requireUser();
      const target = me.role === 'admin' ? userId : me.id;
      return db().logins.filter((l) => !target || l.user_id === target).slice(0, Math.min(Number(limit) || 100, 500));
    },
  };
}
