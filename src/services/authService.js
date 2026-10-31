const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

// Active memory sessions token map: token -> { userId, email, role, customerId, expiresAt }
const activeSessions = new Map();

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length <= 8) {
    return { valid: false, message: 'Password must be more than 8 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character' };
  }
  return { valid: true };
}

function hashPassword(password, salt = null) {
  const passwordSalt = salt || crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(password, passwordSalt, 1000, 64, 'sha512').toString('hex');
  return { passwordHash, passwordSalt };
}

function verifyPassword(password, hash, salt) {
  const result = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return result === hash;
}

function registerUser({ email, password, name, role = 'customer', customerId = null, creatorRole = null }) {
  const db = getDatabase();

  const normalizedEmail = email.trim().toLowerCase();

  // Rule: Only admin can add a new member of staff
  if (role === 'staff' || role === 'admin') {
    if (creatorRole !== 'admin') {
      throw new Error('Unauthorized: Only an admin can add a new staff member or admin');
    }
  }

  // Check email uniqueness
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    throw new Error('An account with this email already exists');
  }

  // Validate password
  const validation = validatePassword(password);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const { passwordHash, passwordSalt } = hashPassword(password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  // If customer role and customerId is not provided, create a customer profile
  let finalCustomerId = customerId;
  if (role === 'customer' && !finalCustomerId) {
    finalCustomerId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO customers (id, name, email, company_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(finalCustomerId, name, normalizedEmail, name, now);
  }

  db.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, name, role, customer_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, normalizedEmail, passwordHash, passwordSalt, name, role, finalCustomerId, now);

  return {
    id: userId,
    email: normalizedEmail,
    name,
    role,
    customerId: finalCustomerId
  };
}

function loginUser(email, password) {
  const db = getDatabase();
  const normalizedEmail = (email || '').trim().toLowerCase();

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) {
    throw new Error('Invalid email or password');
  }

  const isMatch = verifyPassword(password, user.password_hash, user.password_salt);
  if (!isMatch) {
    throw new Error('Invalid email or password');
  }

  // Create session token
  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    customerId: user.customer_id,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  };
  activeSessions.set(token, sessionData);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customer_id
    }
  };
}

function verifySession(token) {
  if (!token) return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

function logoutUser(token) {
  if (token) {
    activeSessions.delete(token);
  }
}

function requestPasswordReset(email) {
  const db = getDatabase();
  const normalizedEmail = (email || '').trim().toLowerCase();

  const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) {
    // For security reasons, don't reveal email presence, but in our demo return status
    return { success: true, message: 'If this email is registered, a password reset link has been sent.' };
  }

  const token = crypto.randomBytes(24).toString('hex');
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO password_resets (id, user_id, token, expires_at, used, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, user.id, token, expiresAt, now);

  return {
    success: true,
    message: 'Reset link generated successfully',
    resetToken: token,
    email: user.email,
    resetLink: `/reset-password.html?token=${token}`
  };
}

function resetPasswordWithToken(token, newPassword) {
  const db = getDatabase();
  const resetRecord = db.prepare(`
    SELECT * FROM password_resets WHERE token = ? AND used = 0
  `).get(token);

  if (!resetRecord) {
    throw new Error('Invalid or expired password reset link');
  }

  if (new Date(resetRecord.expires_at) < new Date()) {
    throw new Error('This password reset link has expired');
  }

  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const { passwordHash, passwordSalt } = hashPassword(newPassword);

  db.prepare(`
    UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?
  `).run(passwordHash, passwordSalt, resetRecord.user_id);

  db.prepare(`
    UPDATE password_resets SET used = 1 WHERE id = ?
  `).run(resetRecord.id);

  return { success: true, message: 'Password has been successfully updated' };
}

module.exports = {
  validatePassword,
  hashPassword,
  verifyPassword,
  registerUser,
  loginUser,
  verifySession,
  logoutUser,
  requestPasswordReset,
  resetPasswordWithToken
};

