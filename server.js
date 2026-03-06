require('dotenv').config();

const crypto = require('crypto');
const disposableDomainsList = require('disposable-email-domains');
const express = require('express');
const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const Stripe = require('stripe');

const app = express();

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORAGE_DIR = path.join(ROOT_DIR, 'storage');
const USERS_FILE = path.join(STORAGE_DIR, 'users.json');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions.json');
const PAYMENTS_FILE = path.join(STORAGE_DIR, 'payments.json');
const SUPPORT_FILE = path.join(STORAGE_DIR, 'support.json');
const SUPPORT_UPLOAD_URL_PREFIX = '/uploads/support';
const SUPPORT_UPLOAD_DIR = path.join(ROOT_DIR, 'public', 'uploads', 'support');
const PASSWORD_RESETS_FILE = path.join(STORAGE_DIR, 'password_resets.json');
const NEWSLETTERS_FILE = path.join(STORAGE_DIR, 'newsletters.json');
const COUPONS_FILE = path.join(STORAGE_DIR, 'coupons.json');

const SESSION_COOKIE = 'horizon_session';
const SESSION_TTL_DAYS = 30;
const LICENSE_DAYS = Number(process.env.LICENSE_DAYS || 14);
const LICENSE_PRICE_CENTS = Number(process.env.LICENSE_PRICE_CENTS || 1000);
const LICENSE_CURRENCY = (process.env.LICENSE_CURRENCY || 'chf').toLowerCase();
const SUBSCRIPTION_INTERVAL_DAYS = Number(process.env.SUBSCRIPTION_INTERVAL_DAYS || 14);
const ENABLE_TWINT = String(process.env.ENABLE_TWINT || '').trim().toLowerCase() === 'true';
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || 'donati@gionata.ch');
const ADMIN_NAME = String(process.env.ADMIN_NAME || 'Gionata Donati').trim() || 'Gionata Donati';
const ADMIN_BOOTSTRAP_PASSWORD = String(
  process.env.ADMIN_BOOTSTRAP_PASSWORD || 'DonatiAdmin!2026',
);
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 30);
const EMAIL_VERIFY_TOKEN_TTL_HOURS = Number(process.env.EMAIL_VERIFY_TOKEN_TTL_HOURS || 24);
const FREE_TRIAL_DAYS = Number(process.env.FREE_TRIAL_DAYS || 1);
const SUPPORT_ATTACHMENT_MAX_BYTES = Number(
  process.env.SUPPORT_ATTACHMENT_MAX_BYTES || 6 * 1024 * 1024,
);
const MAX_USER_NOTIFICATIONS = Number(process.env.MAX_USER_NOTIFICATIONS || 200);
const SUPPORT_ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const AUTO_RENEW_LOCKED =
  String(process.env.AUTO_RENEW_LOCKED || 'false').trim().toLowerCase() === 'true';
const cookieSecureEnv = String(process.env.COOKIE_SECURE || '').trim().toLowerCase();
const COOKIE_SECURE =
  cookieSecureEnv === 'true' ||
  (cookieSecureEnv !== 'false' &&
    process.env.NODE_ENV === 'production' &&
    String(process.env.APP_BASE_URL || '').toLowerCase().startsWith('https://'));

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const SMTP_HOST = String(process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';
const SMTP_USER = String(process.env.SMTP_USER || '').trim();
const SMTP_PASS = String(process.env.SMTP_PASS || '');
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || 'no-reply@tropobank.local').trim();
const disposableDomains = new Set(
  (Array.isArray(disposableDomainsList) ? disposableDomainsList : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean),
);

const mailTransport =
  SMTP_HOST && SMTP_PORT && SMTP_FROM
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      })
    : null;

let questionCache = {
  builtAt: 0,
  data: [],
};

function ensureStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(SUPPORT_UPLOAD_DIR, { recursive: true });
  ensureJsonFile(USERS_FILE, { users: [] });
  ensureJsonFile(SESSIONS_FILE, { sessions: [] });
  ensureJsonFile(PAYMENTS_FILE, { processedCheckoutSessionIds: [] });
  ensureJsonFile(SUPPORT_FILE, { requests: [] });
  ensureJsonFile(PASSWORD_RESETS_FILE, { tokens: [] });
  ensureJsonFile(NEWSLETTERS_FILE, { newsletters: [] });
  ensureJsonFile(COUPONS_FILE, { coupons: [] });
}

function ensureJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, fallback);
  }
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function loadUsersState() {
  const state = readJson(USERS_FILE, { users: [] });
  if (!state || !Array.isArray(state.users)) {
    return { users: [] };
  }
  state.users = state.users.map((user) => {
    const normalized = { ...user };
    const fallbackSeenAt = normalized.updatedAt || normalized.createdAt || new Date().toISOString();
    if (normalized.role !== 'admin') {
      normalized.role = 'user';
    }
    if (typeof normalized.emailVerified !== 'boolean') {
      normalized.emailVerified = true;
    }
    normalized.emailVerificationToken = normalized.emailVerificationToken || null;
    normalized.emailVerificationExpiresAt = normalized.emailVerificationExpiresAt || null;
    normalized.stripeCustomerId = normalized.stripeCustomerId || null;
    normalized.stripeSubscriptionId = normalized.stripeSubscriptionId || null;
    normalized.subscriptionStatus = normalized.subscriptionStatus || null;
    normalized.autoRenew = Boolean(normalized.autoRenew);
    normalized.trialGranted = Boolean(normalized.trialGranted);
    normalized.trialGrantedAt = normalized.trialGrantedAt || null;
    normalized.trialEndsAt = normalized.trialEndsAt || null;
    normalized.notificationsSupportSeenAt = normalized.notificationsSupportSeenAt || fallbackSeenAt;
    normalized.notificationsNewsSeenAt = normalized.notificationsNewsSeenAt || fallbackSeenAt;
    normalized.notificationsGeneralSeenAt = normalized.notificationsGeneralSeenAt || fallbackSeenAt;
    const eventEntries = Array.isArray(normalized.notificationsEvents)
      ? normalized.notificationsEvents
      : [];
    normalized.notificationsEvents = eventEntries
      .map((entry) => normalizeNotificationEntry(entry))
      .filter(Boolean)
      .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt))
      .slice(0, MAX_USER_NOTIFICATIONS);
    return normalized;
  });
  return state;
}

function saveUsersState(state) {
  writeJson(USERS_FILE, state);
}

function loadSessionsState() {
  const state = readJson(SESSIONS_FILE, { sessions: [] });
  if (!state || !Array.isArray(state.sessions)) {
    return { sessions: [] };
  }
  return state;
}

function saveSessionsState(state) {
  writeJson(SESSIONS_FILE, state);
}

function loadPaymentsState() {
  const state = readJson(PAYMENTS_FILE, { processedCheckoutSessionIds: [] });
  if (!state || !Array.isArray(state.processedCheckoutSessionIds)) {
    return { processedCheckoutSessionIds: [] };
  }
  return state;
}

function savePaymentsState(state) {
  writeJson(PAYMENTS_FILE, state);
}

function loadPasswordResetsState() {
  const state = readJson(PASSWORD_RESETS_FILE, { tokens: [] });
  if (!state || !Array.isArray(state.tokens)) {
    return { tokens: [] };
  }

  const now = Date.now();
  state.tokens = state.tokens.filter((entry) => {
    if (entry.usedAt) {
      return false;
    }
    const expiresAt = Date.parse(entry.expiresAt || '');
    if (Number.isNaN(expiresAt)) {
      return false;
    }
    return expiresAt > now;
  });

  return state;
}

function savePasswordResetsState(state) {
  writeJson(PASSWORD_RESETS_FILE, state);
}

function normalizeSupportStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'answered' || value === 'closed') {
    return value;
  }
  return 'open';
}

function isValidSupportStatus(status) {
  return status === 'open' || status === 'answered' || status === 'closed';
}

function supportAttachmentExtensionFromMime(mimeType) {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  if (mimeType === 'image/gif') {
    return 'gif';
  }
  return '';
}

function sanitizeSupportAttachmentFileName(fileName) {
  const fallback = 'support-image';
  const cleaned = String(fileName || '')
    .trim()
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

function normalizeSupportAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }

  const url = String(attachment.url || '').trim();
  const mimeTypeRaw = String(attachment.mimeType || '').trim().toLowerCase();
  const mimeType = mimeTypeRaw === 'image/jpg' ? 'image/jpeg' : mimeTypeRaw;
  const fileName = sanitizeSupportAttachmentFileName(
    attachment.fileName || attachment.originalName || attachment.name,
  );
  const sizeBytes = Number.parseInt(attachment.sizeBytes || attachment.size, 10);

  if (!url.startsWith(`${SUPPORT_UPLOAD_URL_PREFIX}/`)) {
    return null;
  }
  if (!SUPPORT_ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
    return null;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
    return null;
  }

  return {
    url,
    mimeType,
    fileName,
    sizeBytes,
  };
}

function storeSupportAttachment(rawAttachment) {
  if (rawAttachment === null || rawAttachment === undefined) {
    return { attachment: null };
  }
  if (typeof rawAttachment !== 'object') {
    return { error: 'Invalid attachment payload' };
  }

  const dataUrl = String(rawAttachment.dataUrl || '').trim();
  if (!dataUrl) {
    return { error: 'Attachment data is required' };
  }

  const dataMatch = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!dataMatch) {
    return { error: 'Attachment must be a valid base64 image' };
  }

  const parsedMimeType = String(dataMatch[1] || '').trim().toLowerCase();
  const mimeType = parsedMimeType === 'image/jpg' ? 'image/jpeg' : parsedMimeType;
  const declaredMimeTypeRaw = String(rawAttachment.mimeType || '').trim().toLowerCase();
  const declaredMimeType = declaredMimeTypeRaw === 'image/jpg' ? 'image/jpeg' : declaredMimeTypeRaw;
  const effectiveMimeType = declaredMimeType || mimeType;

  if (!SUPPORT_ATTACHMENT_ALLOWED_MIME_TYPES.has(effectiveMimeType)) {
    return { error: 'Only JPG, PNG, WEBP, or GIF images are allowed' };
  }
  if (mimeType !== effectiveMimeType) {
    return { error: 'Attachment type mismatch' };
  }

  const extension = supportAttachmentExtensionFromMime(effectiveMimeType);
  if (!extension) {
    return { error: 'Unsupported attachment type' };
  }

  let imageBuffer;
  try {
    imageBuffer = Buffer.from(String(dataMatch[2] || '').replace(/\s+/g, ''), 'base64');
  } catch (error) {
    return { error: 'Attachment decoding failed' };
  }

  if (!imageBuffer || !imageBuffer.length) {
    return { error: 'Attachment is empty' };
  }
  if (imageBuffer.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
    return {
      error: `Attachment too large. Max ${Math.floor(
        SUPPORT_ATTACHMENT_MAX_BYTES / (1024 * 1024),
      )} MB`,
    };
  }

  const fileId = `${Date.now()}_${randomId(6)}.${extension}`;
  const filePath = path.join(SUPPORT_UPLOAD_DIR, fileId);
  try {
    fs.writeFileSync(filePath, imageBuffer);
  } catch (error) {
    console.error('Support attachment save failed', error);
    return { error: 'Attachment upload failed' };
  }

  return {
    attachment: {
      url: `${SUPPORT_UPLOAD_URL_PREFIX}/${fileId}`,
      mimeType: effectiveMimeType,
      fileName: sanitizeSupportAttachmentFileName(rawAttachment.fileName || rawAttachment.name),
      sizeBytes: imageBuffer.length,
    },
  };
}

function removeSupportAttachmentFile(attachment) {
  const normalized = normalizeSupportAttachment(attachment);
  if (!normalized) {
    return;
  }

  const fileName = path.basename(normalized.url);
  if (!fileName) {
    return;
  }

  const filePath = path.join(SUPPORT_UPLOAD_DIR, fileName);
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      console.error('Support attachment delete failed', error);
    }
  }
}

function loadSupportState() {
  const state = readJson(SUPPORT_FILE, { requests: [] });
  if (!state || !Array.isArray(state.requests)) {
    return { requests: [] };
  }

  state.requests = state.requests.map((request) => ({
    ...request,
    status: normalizeSupportStatus(request.status),
    attachment: normalizeSupportAttachment(request.attachment),
  }));

  return state;
}

function saveSupportState(state) {
  writeJson(SUPPORT_FILE, state);
}

function loadNewslettersState() {
  const state = readJson(NEWSLETTERS_FILE, { newsletters: [] });
  if (!state || !Array.isArray(state.newsletters)) {
    return { newsletters: [] };
  }
  state.newsletters = state.newsletters.map((entry) => ({
    ...entry,
    publishedAt: entry.publishedAt || entry.createdAt || null,
  }));
  return state;
}

function saveNewslettersState(state) {
  writeJson(NEWSLETTERS_FILE, state);
}

function normalizeCouponCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function validCouponCode(code) {
  return /^[A-Z0-9-]{4,40}$/.test(code);
}

function normalizeCouponStateEntry(entry) {
  const nowIso = new Date().toISOString();
  const normalized = { ...entry };
  normalized.id = normalized.id || randomId(10);
  normalized.code = normalizeCouponCode(normalized.code);
  normalized.days = Math.max(1, Math.min(365, Number.parseInt(normalized.days, 10) || LICENSE_DAYS));
  const maxRaw = Number.parseInt(normalized.maxRedemptions, 10);
  normalized.maxRedemptions = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : null;
  normalized.expiresAt =
    normalized.expiresAt && !Number.isNaN(Date.parse(normalized.expiresAt))
      ? new Date(normalized.expiresAt).toISOString()
      : null;
  normalized.active = normalized.active !== false;
  normalized.note = String(normalized.note || '').trim().slice(0, 160);
  normalized.createdAt = normalized.createdAt || nowIso;
  normalized.updatedAt = normalized.updatedAt || normalized.createdAt;
  normalized.createdBy = String(normalized.createdBy || 'admin');
  normalized.redemptions = Array.isArray(normalized.redemptions)
    ? normalized.redemptions
        .map((redemption) => ({
          userId: String(redemption.userId || ''),
          userEmail: normalizeEmail(redemption.userEmail || ''),
          redeemedAt: redemption.redeemedAt || nowIso,
          daysApplied: Math.max(
            1,
            Math.min(365, Number.parseInt(redemption.daysApplied, 10) || normalized.days),
          ),
        }))
        .filter((redemption) => redemption.userId && redemption.userEmail)
    : [];
  return normalized;
}

function loadCouponsState() {
  const state = readJson(COUPONS_FILE, { coupons: [] });
  if (!state || !Array.isArray(state.coupons)) {
    return { coupons: [] };
  }
  state.coupons = state.coupons.map(normalizeCouponStateEntry);
  return state;
}

function saveCouponsState(state) {
  writeJson(COUPONS_FILE, state);
}

function isCouponExpired(coupon) {
  if (!coupon || !coupon.expiresAt) {
    return false;
  }
  const expiresAt = Date.parse(coupon.expiresAt);
  if (Number.isNaN(expiresAt)) {
    return false;
  }
  return expiresAt <= Date.now();
}

function couponRemainingRedemptions(coupon) {
  if (!coupon || !Number.isFinite(coupon.maxRedemptions)) {
    return null;
  }
  return Math.max(0, coupon.maxRedemptions - coupon.redemptions.length);
}

function couponStatus(coupon) {
  if (!coupon.active) {
    return 'inactive';
  }
  if (isCouponExpired(coupon)) {
    return 'expired';
  }
  if (Number.isFinite(coupon.maxRedemptions) && coupon.redemptions.length >= coupon.maxRedemptions) {
    return 'exhausted';
  }
  return 'active';
}

function publicCouponForAdmin(coupon) {
  const sortedRedemptions = coupon.redemptions
    .slice()
    .sort((a, b) => compareIsoDesc(a.redeemedAt, b.redeemedAt));
  return {
    id: coupon.id,
    code: coupon.code,
    days: coupon.days,
    maxRedemptions: coupon.maxRedemptions,
    remainingRedemptions: couponRemainingRedemptions(coupon),
    redemptionsCount: coupon.redemptions.length,
    expiresAt: coupon.expiresAt,
    active: coupon.active,
    status: couponStatus(coupon),
    note: coupon.note || '',
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
    createdBy: coupon.createdBy,
    lastRedeemedAt: sortedRedemptions.length ? sortedRedemptions[0].redeemedAt : null,
    recentRedemptions: sortedRedemptions.slice(0, 8),
  };
}

function listAdminCoupons() {
  const couponsState = loadCouponsState();
  return couponsState.coupons
    .slice()
    .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt))
    .map(publicCouponForAdmin);
}

function createCoupon(authorUser, payload) {
  const code = normalizeCouponCode(payload.code);
  const days = Math.max(1, Math.min(365, Number.parseInt(payload.days, 10) || LICENSE_DAYS));
  const maxRaw = Number.parseInt(payload.maxRedemptions, 10);
  const maxRedemptions = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : null;
  const note = String(payload.note || '').trim().slice(0, 160);
  const expiresAtRaw = String(payload.expiresAt || '').trim();
  const expiresAt =
    expiresAtRaw && !Number.isNaN(Date.parse(expiresAtRaw))
      ? new Date(expiresAtRaw).toISOString()
      : null;

  const couponsState = loadCouponsState();
  const exists = couponsState.coupons.some((entry) => normalizeCouponCode(entry.code) === code);
  if (exists) {
    return { error: 'COUPON_EXISTS' };
  }

  const nowIso = new Date().toISOString();
  const coupon = normalizeCouponStateEntry({
    id: randomId(10),
    code,
    days,
    maxRedemptions,
    expiresAt,
    active: true,
    note,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: authorUser.email || authorUser.name || 'admin',
    redemptions: [],
  });

  couponsState.coupons.push(coupon);
  saveCouponsState(couponsState);
  return { coupon };
}

function updateCouponStatus(couponId, active) {
  const couponsState = loadCouponsState();
  const coupon = couponsState.coupons.find((entry) => entry.id === couponId);
  if (!coupon) {
    return null;
  }
  coupon.active = Boolean(active);
  coupon.updatedAt = new Date().toISOString();
  saveCouponsState(couponsState);
  return coupon;
}

function deleteCouponById(couponId) {
  const couponsState = loadCouponsState();
  const index = couponsState.coupons.findIndex((entry) => entry.id === couponId);
  if (index === -1) {
    return null;
  }

  const [coupon] = couponsState.coupons.splice(index, 1);
  saveCouponsState(couponsState);
  return coupon;
}

function redeemCouponForUser(userId, rawCode) {
  const code = normalizeCouponCode(rawCode);
  if (!validCouponCode(code)) {
    return { error: 'COUPON_INVALID' };
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user) {
    return { error: 'USER_NOT_FOUND' };
  }

  const couponsState = loadCouponsState();
  const coupon = couponsState.coupons.find((entry) => normalizeCouponCode(entry.code) === code);
  if (!coupon) {
    return { error: 'COUPON_NOT_FOUND' };
  }
  if (!coupon.active) {
    return { error: 'COUPON_INACTIVE' };
  }
  if (isCouponExpired(coupon)) {
    return { error: 'COUPON_EXPIRED' };
  }
  if (Number.isFinite(coupon.maxRedemptions) && coupon.redemptions.length >= coupon.maxRedemptions) {
    return { error: 'COUPON_EXHAUSTED' };
  }
  if (coupon.redemptions.some((entry) => entry.userId === user.id)) {
    return { error: 'COUPON_ALREADY_USED' };
  }

  const now = Date.now();
  const currentExpiry = Date.parse(user.licenseExpiresAt || '');
  const baseTime = Number.isNaN(currentExpiry) || currentExpiry < now ? now : currentExpiry;
  const nextExpiry = new Date(baseTime + coupon.days * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  user.licenseExpiresAt = nextExpiry;
  user.updatedAt = nowIso;
  appendUserNotification(user, {
    id: `coupon_${coupon.id}_${nowIso}`,
    scope: 'billing',
    title: 'Coupon applied',
    body: `${coupon.code} applied: +${coupon.days} days. Access active until ${new Date(
      nextExpiry,
    ).toLocaleDateString('en-US')}.`,
    createdAt: nowIso,
    link: '/settings#couponSection',
  });

  coupon.redemptions.push({
    userId: user.id,
    userEmail: user.email,
    redeemedAt: nowIso,
    daysApplied: coupon.days,
  });
  coupon.updatedAt = nowIso;

  saveUsersState(usersState);
  saveCouponsState(couponsState);

  return {
    user,
    coupon,
    daysAdded: coupon.days,
    licenseExpiresAt: nextExpiry,
  };
}

function listPublishedNewsletters() {
  const newslettersState = loadNewslettersState();
  return newslettersState.newsletters
    .filter((entry) => Boolean(entry.publishedAt))
    .sort((a, b) => compareIsoDesc(a.publishedAt, b.publishedAt));
}

function listAdminNewsletters() {
  const newslettersState = loadNewslettersState();
  return newslettersState.newsletters
    .slice()
    .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
}

function publicNewsletterForUser(entry) {
  return {
    id: entry.id,
    title: entry.title,
    message: entry.message,
    createdAt: entry.createdAt,
    publishedAt: entry.publishedAt || null,
    authorName: entry.authorName || null,
  };
}

function createNewsletter(authorUser, title, message) {
  const newslettersState = loadNewslettersState();
  const nowIso = new Date().toISOString();
  const newsletter = {
    id: randomId(10),
    title,
    message,
    createdAt: nowIso,
    publishedAt: nowIso,
    authorName: authorUser.name || authorUser.email || 'Admin',
    authorEmail: authorUser.email || null,
  };
  newslettersState.newsletters.push(newsletter);
  saveNewslettersState(newslettersState);
  return newsletter;
}

function supportStatusRank(status) {
  if (status === 'open') {
    return 0;
  }
  if (status === 'answered') {
    return 1;
  }
  return 2;
}

function compareIsoDesc(leftIso, rightIso) {
  const left = Date.parse(leftIso || '');
  const right = Date.parse(rightIso || '');
  const leftValue = Number.isNaN(left) ? 0 : left;
  const rightValue = Number.isNaN(right) ? 0 : right;
  return rightValue - leftValue;
}

function publicSupportRequestForUser(request) {
  return {
    id: request.id,
    subject: request.subject,
    message: request.message,
    status: normalizeSupportStatus(request.status),
    adminReply: request.adminReply || null,
    repliedAt: request.repliedAt || null,
    attachment: normalizeSupportAttachment(request.attachment),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function publicSupportRequestForAdmin(request) {
  return {
    id: request.id,
    userId: request.userId,
    userName: request.userName,
    userEmail: request.userEmail,
    subject: request.subject,
    message: request.message,
    status: normalizeSupportStatus(request.status),
    adminReply: request.adminReply || null,
    repliedAt: request.repliedAt || null,
    repliedBy: request.repliedBy || null,
    attachment: normalizeSupportAttachment(request.attachment),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function listSupportRequestsForUser(userId) {
  const supportState = loadSupportState();
  return supportState.requests
    .filter((request) => request.userId === userId)
    .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt))
    .map(publicSupportRequestForUser);
}

function listSupportRequestsForAdmin() {
  const supportState = loadSupportState();
  return supportState.requests
    .slice()
    .sort((a, b) => {
      const rankDiff = supportStatusRank(a.status) - supportStatusRank(b.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return compareIsoDesc(a.updatedAt, b.updatedAt);
    })
    .map(publicSupportRequestForAdmin);
}

function parseIsoMs(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function normalizeNotificationScope(scope) {
  const value = String(scope || '')
    .trim()
    .toLowerCase();
  if (
    value === 'support' ||
    value === 'news' ||
    value === 'security' ||
    value === 'billing' ||
    value === 'system'
  ) {
    return value;
  }
  if (value === 'newsletter') {
    return 'news';
  }
  return 'system';
}

function normalizeNotificationLink(link, fallback = '/app') {
  const clean = String(link || '').trim();
  if (!clean) {
    return fallback;
  }
  if (clean.startsWith('/')) {
    return clean;
  }
  return fallback;
}

function normalizeNotificationEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const createdAtRaw = String(entry.createdAt || '').trim();
  const createdAt = !Number.isNaN(Date.parse(createdAtRaw))
    ? new Date(createdAtRaw).toISOString()
    : new Date().toISOString();
  const scope = normalizeNotificationScope(entry.scope || entry.type);
  const id = String(entry.id || '').trim() || `notif_${randomId(8)}`;
  const title = String(entry.title || '').trim().slice(0, 160);
  const body = String(entry.body || '').trim().slice(0, 800);
  const link = normalizeNotificationLink(entry.link, '/app');

  if (!title && !body) {
    return null;
  }

  return {
    id,
    type: scope,
    scope,
    title: title || 'Notification',
    body,
    createdAt,
    link,
  };
}

function appendUserNotification(user, payload) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const normalized = normalizeNotificationEntry(payload);
  if (!normalized) {
    return null;
  }

  const current = Array.isArray(user.notificationsEvents) ? user.notificationsEvents : [];
  const next = [normalized, ...current]
    .map((entry) => normalizeNotificationEntry(entry))
    .filter(Boolean)
    .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt))
    .slice(0, MAX_USER_NOTIFICATIONS);
  user.notificationsEvents = next;
  return normalized;
}

function enqueueUserNotification(userId, payload) {
  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user) {
    return null;
  }
  const notification = appendUserNotification(user, payload);
  if (!notification) {
    return null;
  }
  user.updatedAt = new Date().toISOString();
  saveUsersState(usersState);
  return notification;
}

function buildNotificationsForUser(user) {
  const supportSeenAtMs = parseIsoMs(user.notificationsSupportSeenAt);
  const newsSeenAtMs = parseIsoMs(user.notificationsNewsSeenAt);
  const generalSeenAtMs = parseIsoMs(user.notificationsGeneralSeenAt);
  const supportState = loadSupportState();
  const publishedNewsletters = listPublishedNewsletters();
  const items = [];

  supportState.requests.forEach((request) => {
    if (request.userId !== user.id || !request.repliedAt) {
      return;
    }
    const repliedAtMs = parseIsoMs(request.repliedAt);
    if (repliedAtMs <= supportSeenAtMs) {
      return;
    }
    items.push({
      id: `support_${request.id}_${request.repliedAt}`,
      type: 'support',
      scope: 'support',
      title: `Support reply: ${request.subject || 'Request'}`,
      body: request.adminReply || 'Admin replied to your support request.',
      createdAt: request.repliedAt,
      link: '/settings',
    });
  });

  publishedNewsletters.forEach((newsletter) => {
    const publishedAtMs = parseIsoMs(newsletter.publishedAt);
    if (publishedAtMs <= newsSeenAtMs) {
      return;
    }
    items.push({
      id: `newsletter_${newsletter.id}_${newsletter.publishedAt}`,
      type: 'newsletter',
      scope: 'news',
      title: newsletter.title || 'Newsletter',
      body: newsletter.message || '',
      createdAt: newsletter.publishedAt,
      link: '/app',
    });
  });

  const eventEntries = Array.isArray(user.notificationsEvents) ? user.notificationsEvents : [];
  eventEntries.forEach((entry) => {
    const normalized = normalizeNotificationEntry(entry);
    if (!normalized) {
      return;
    }
    const createdAtMs = parseIsoMs(normalized.createdAt);
    if (createdAtMs <= generalSeenAtMs) {
      return;
    }
    items.push(normalized);
  });

  items.sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
  return {
    unreadCount: items.length,
    items,
  };
}

function markNotificationsAsRead(userId, scope) {
  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user) {
    return null;
  }

  const normalizedScope = String(scope || 'all').trim().toLowerCase();
  const nowIso = new Date().toISOString();

  if (normalizedScope === 'all' || normalizedScope === 'support') {
    user.notificationsSupportSeenAt = nowIso;
  }
  if (normalizedScope === 'all' || normalizedScope === 'news') {
    user.notificationsNewsSeenAt = nowIso;
  }
  if (
    normalizedScope === 'all' ||
    normalizedScope === 'general' ||
    normalizedScope === 'security' ||
    normalizedScope === 'billing' ||
    normalizedScope === 'system'
  ) {
    user.notificationsGeneralSeenAt = nowIso;
  }

  user.updatedAt = nowIso;
  saveUsersState(usersState);
  return user;
}

function randomId(size = 24) {
  return crypto.randomBytes(size).toString('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getEmailDomain(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at >= normalized.length - 1) {
    return '';
  }
  return normalized.slice(at + 1);
}

function isDisposableEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) {
    return false;
  }
  if (disposableDomains.has(domain)) {
    return true;
  }

  for (const blockedDomain of disposableDomains) {
    if (domain.endsWith(`.${blockedDomain}`)) {
      return true;
    }
  }

  return false;
}

function emailVerificationExpiresAt() {
  return new Date(Date.now() + EMAIL_VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordRecord(password) {
  const passwordSalt = randomId(16);
  const passwordHash = hashPassword(password, passwordSalt);
  return { passwordSalt, passwordHash };
}

function verifyPassword(password, user) {
  const computed = hashPassword(password, user.passwordSalt);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function hasActiveLicense(user) {
  if (!user.licenseExpiresAt) {
    return false;
  }
  const expiresAt = Date.parse(user.licenseExpiresAt);
  if (Number.isNaN(expiresAt)) {
    return false;
  }
  return expiresAt > Date.now();
}

function getDaysRemaining(expiresAtIso) {
  const expiresAt = Date.parse(expiresAtIso || '');
  if (Number.isNaN(expiresAt)) {
    return 0;
  }
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function unixToIso(seconds) {
  if (!Number.isFinite(Number(seconds))) {
    return null;
  }
  return new Date(Number(seconds) * 1000).toISOString();
}

function publicUser(user) {
  const licenseActive = hasActiveLicense(user);
  const daysRemaining = getDaysRemaining(user.licenseExpiresAt);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    role: user.role || 'user',
    licenseExpiresAt: user.licenseExpiresAt,
    licenseActive,
    daysRemaining,
    stripeCustomerId: user.stripeCustomerId || null,
    stripeSubscriptionId: user.stripeSubscriptionId || null,
    subscriptionStatus: user.subscriptionStatus || null,
    autoRenew: Boolean(user.autoRenew),
    trialGranted: Boolean(user.trialGranted),
    trialGrantedAt: user.trialGrantedAt || null,
    trialEndsAt: user.trialEndsAt || null,
    createdAt: user.createdAt,
  };
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const map = {};
  if (!header) {
    return map;
  }

  header.split(';').forEach((chunk) => {
    const trimmed = chunk.trim();
    const index = trimmed.indexOf('=');
    if (index <= 0) {
      return;
    }
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    map[key] = decodeURIComponent(value);
  });

  return map;
}

function serializeCookie(name, value, maxAgeSeconds) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (typeof maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  if (COOKIE_SECURE) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function setSessionCookie(res, sessionId) {
  const ttl = SESSION_TTL_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, sessionId, ttl));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', 0));
}

function getAuthContext(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];

  if (!sessionId) {
    return { error: 'NO_SESSION' };
  }

  const sessionsState = loadSessionsState();
  const usersState = loadUsersState();

  const session = sessionsState.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return { error: 'SESSION_NOT_FOUND' };
  }

  const user = usersState.users.find((entry) => entry.id === session.userId);
  if (!user) {
    sessionsState.sessions = sessionsState.sessions.filter((entry) => entry.id !== sessionId);
    saveSessionsState(sessionsState);
    return { error: 'USER_NOT_FOUND' };
  }

  if (user.currentSessionId !== sessionId) {
    sessionsState.sessions = sessionsState.sessions.filter((entry) => entry.id !== sessionId);
    saveSessionsState(sessionsState);
    return { error: 'SESSION_REVOKED' };
  }

  const now = Date.now();
  const lastSeenAt = Date.parse(session.lastSeenAt || session.createdAt);
  const maxIdleMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isNaN(lastSeenAt) && now - lastSeenAt > maxIdleMs) {
    sessionsState.sessions = sessionsState.sessions.filter((entry) => entry.id !== sessionId);
    user.currentSessionId = null;
    user.updatedAt = new Date().toISOString();
    saveSessionsState(sessionsState);
    saveUsersState(usersState);
    return { error: 'SESSION_EXPIRED' };
  }

  session.lastSeenAt = new Date().toISOString();
  saveSessionsState(sessionsState);

  return {
    user,
    session,
  };
}

function requireAuth(req, res, next) {
  const context = getAuthContext(req);

  if (!context.user) {
    clearSessionCookie(res);
    return res.status(401).json({
      error: 'AUTH_REQUIRED',
      reason: context.error || 'NO_SESSION',
    });
  }

  req.user = context.user;
  req.session = context.session;
  return next();
}

function requireActiveLicense(req, res, next) {
  if (!hasActiveLicense(req.user)) {
    return res.status(402).json({
      error: 'LICENSE_REQUIRED',
      licenseExpiresAt: req.user.licenseExpiresAt,
    });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ADMIN_REQUIRED' });
  }
  return next();
}

function buildLoginRedirectPath(nextPath, from) {
  const params = new URLSearchParams();
  params.set('reason', 'login_required');
  params.set('next', nextPath || '/app');
  if (from) {
    params.set('from', from);
  }
  return `login?${params.toString()}`;
}

function requirePageLogin(nextPath, from) {
  return (req, res, next) => {
    const context = getAuthContext(req);
    if (!context.user) {
      clearSessionCookie(res);
      return res.redirect(302, buildLoginRedirectPath(nextPath, from));
    }

    req.user = context.user;
    req.session = context.session;
    return next();
  };
}

function buildQuestionsCache() {
  const rows = [];
  const files = fs.readdirSync(DATA_DIR).filter((file) => file.endsWith('.json'));

  for (const file of files) {
    const fullPath = path.join(DATA_DIR, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        continue;
      }

      parsed.forEach((question) => {
        rows.push({
          ...question,
          source: file,
        });
      });
    } catch (error) {
      console.error(`Cannot parse ${file}: ${error.message}`);
    }
  }

  questionCache = {
    builtAt: Date.now(),
    data: rows,
  };
}

function getQuestions() {
  const shouldRefresh =
    !questionCache.data.length || Date.now() - questionCache.builtAt > 60 * 1000;
  if (shouldRefresh) {
    buildQuestionsCache();
  }
  return questionCache.data;
}

function searchQuestions(query) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) {
    return [];
  }

  const matches = [];

  for (const item of getQuestions()) {
    const question = String(item.question || '').toLowerCase();
    const feedback = String(item.feedback || '').toLowerCase();

    let score = 0;
    if (question.includes(normalized)) {
      score += 3;
    }
    if (feedback.includes(normalized)) {
      score += 1;
    }

    if (score > 0) {
      matches.push({
        score,
        item,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  return matches.slice(0, 80).map((row) => row.item);
}

function issueSession(user, req, res) {
  const sessionsState = loadSessionsState();

  sessionsState.sessions = sessionsState.sessions.filter(
    (entry) => entry.userId !== user.id && entry.id !== user.currentSessionId,
  );

  const nowIso = new Date().toISOString();
  const sessionId = randomId(24);

  sessionsState.sessions.push({
    id: sessionId,
    userId: user.id,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] || ''),
  });

  user.currentSessionId = sessionId;
  user.updatedAt = nowIso;

  saveSessionsState(sessionsState);
  setSessionCookie(res, sessionId);
}

function revokeSessionById(sessionId) {
  if (!sessionId) {
    return;
  }

  const sessionsState = loadSessionsState();
  const usersState = loadUsersState();

  const session = sessionsState.sessions.find((entry) => entry.id === sessionId);
  sessionsState.sessions = sessionsState.sessions.filter((entry) => entry.id !== sessionId);

  if (session) {
    const user = usersState.users.find((entry) => entry.id === session.userId);
    if (user && user.currentSessionId === sessionId) {
      user.currentSessionId = null;
      user.updatedAt = new Date().toISOString();
      saveUsersState(usersState);
    }
  }

  saveSessionsState(sessionsState);
}

function revokeSessionByUserId(userId) {
  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user || !user.currentSessionId) {
    return false;
  }
  const currentSessionId = user.currentSessionId;
  revokeSessionById(currentSessionId);
  return true;
}

function grantLicense(userId, days) {
  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user) {
    return null;
  }

  const now = Date.now();
  const existing = Date.parse(user.licenseExpiresAt || '');
  const baseTime = Number.isNaN(existing) || existing < now ? now : existing;
  const expiresAt = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();

  user.licenseExpiresAt = expiresAt;
  user.updatedAt = new Date().toISOString();

  saveUsersState(usersState);
  return user;
}

function revokeLicense(userId) {
  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user) {
    return null;
  }
  user.licenseExpiresAt = null;
  user.updatedAt = new Date().toISOString();
  saveUsersState(usersState);
  return user;
}

function deleteUserAccountById(userId, actorUserId) {
  const usersState = loadUsersState();
  const index = usersState.users.findIndex((entry) => entry.id === userId);
  if (index === -1) {
    return { error: 'USER_NOT_FOUND' };
  }

  const target = usersState.users[index];
  if (target.id === actorUserId) {
    return { error: 'CANNOT_DELETE_SELF' };
  }

  if (target.role === 'admin') {
    const adminCount = usersState.users.filter((entry) => entry.role === 'admin').length;
    if (adminCount <= 1) {
      return { error: 'LAST_ADMIN' };
    }
  }

  usersState.users.splice(index, 1);
  saveUsersState(usersState);

  const sessionsState = loadSessionsState();
  sessionsState.sessions = sessionsState.sessions.filter((entry) => entry.userId !== userId);
  saveSessionsState(sessionsState);

  const resetsState = loadPasswordResetsState();
  resetsState.tokens = resetsState.tokens.filter((entry) => entry.userId !== userId);
  savePasswordResetsState(resetsState);

  const supportState = loadSupportState();
  supportState.requests
    .filter((entry) => entry.userId === userId)
    .forEach((entry) => removeSupportAttachmentFile(entry.attachment));
  supportState.requests = supportState.requests.filter((entry) => entry.userId !== userId);
  saveSupportState(supportState);

  const couponsState = loadCouponsState();
  let couponsChanged = false;
  couponsState.coupons = couponsState.coupons.map((coupon) => {
    const before = coupon.redemptions.length;
    coupon.redemptions = coupon.redemptions.filter((entry) => entry.userId !== userId);
    if (coupon.redemptions.length !== before) {
      coupon.updatedAt = new Date().toISOString();
      couponsChanged = true;
    }
    return coupon;
  });
  if (couponsChanged) {
    saveCouponsState(couponsState);
  }

  return {
    user: {
      id: target.id,
      email: target.email,
      name: target.name,
      role: target.role,
    },
  };
}

function applyTrialDataFromSubscription(user, subscription) {
  if (!user || !subscription) {
    return;
  }
  const trialEndsAt = unixToIso(subscription.trial_end);
  if (!trialEndsAt) {
    return;
  }
  const trialGrantedAt = unixToIso(subscription.trial_start) || new Date().toISOString();
  user.trialGranted = true;
  user.trialGrantedAt = user.trialGrantedAt || trialGrantedAt;
  user.trialEndsAt = trialEndsAt;
}

function issueEmailVerificationToken(user) {
  const token = randomId(18);
  user.emailVerificationToken = token;
  user.emailVerificationExpiresAt = emailVerificationExpiresAt();
  user.updatedAt = new Date().toISOString();
  return token;
}

function verificationLink(baseUrl, token) {
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

function passwordResetLink(baseUrl, token) {
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail(user, link) {
  if (!mailTransport) {
    return false;
  }

  const subject = 'Verify your Tropobank account';
  const text = [
    `Hello ${user.name || 'pilot'},`,
    '',
    `Confirm your email to activate your account and start the ${FREE_TRIAL_DAYS}-day free trial.`,
    `Card setup is required. Then ${LICENSE_PRICE_CENTS / 100} ${LICENSE_CURRENCY.toUpperCase()} every ${SUBSCRIPTION_INTERVAL_DAYS} days, cancel anytime.`,
    link,
    '',
    `This link expires in ${EMAIL_VERIFY_TOKEN_TTL_HOURS} hours.`,
  ].join('\n');

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: user.email,
    subject,
    text,
  });

  return true;
}

async function sendPasswordResetEmail(user, token, link, expiresAt) {
  if (!mailTransport) {
    return false;
  }

  const subject = 'Reset your Tropobank password';
  const text = [
    `Hello ${user.name || 'pilot'},`,
    '',
    'We received a request to reset your password.',
    `Reset token: ${token}`,
    '',
    'Paste this token into the reset form, or use the direct link below:',
    link,
    '',
    `This link expires at ${new Date(expiresAt).toUTCString()}.`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: user.email,
    subject,
    text,
  });

  return true;
}

async function sendPasswordResetCompletedEmail(user, changedAtIso) {
  if (!mailTransport) {
    return false;
  }

  const changedAtText = new Date(changedAtIso || Date.now()).toUTCString();
  const subject = 'Your Tropobank password was changed';
  const text = [
    `Hello ${user.name || 'pilot'},`,
    '',
    `Your password was changed on ${changedAtText}.`,
    '',
    'If this was not you, reset your password immediately and contact support.',
  ].join('\n');

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: user.email,
    subject,
    text,
  });

  return true;
}

function verifyUserEmailByToken(token) {
  if (!token) {
    return { error: 'INVALID_TOKEN' };
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.emailVerificationToken === token);
  if (!user) {
    return { error: 'INVALID_TOKEN' };
  }

  const expiresAt = Date.parse(user.emailVerificationExpiresAt || '');
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    user.emailVerificationToken = null;
    user.emailVerificationExpiresAt = null;
    user.updatedAt = new Date().toISOString();
    saveUsersState(usersState);
    return { error: 'TOKEN_EXPIRED' };
  }

  user.emailVerified = true;
  user.emailVerificationToken = null;
  user.emailVerificationExpiresAt = null;
  user.updatedAt = new Date().toISOString();
  saveUsersState(usersState);

  return { user };
}

function ensureAdminUser() {
  if (!validateEmail(ADMIN_EMAIL)) {
    console.warn('Invalid ADMIN_EMAIL; admin bootstrap skipped.');
    return;
  }

  const usersState = loadUsersState();
  const existing = usersState.users.find((entry) => entry.email === ADMIN_EMAIL);

  if (existing) {
    let changed = false;
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      changed = true;
    }
    if (!String(existing.name || '').trim()) {
      existing.name = ADMIN_NAME;
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      saveUsersState(usersState);
    }
    return;
  }

  if (ADMIN_BOOTSTRAP_PASSWORD.length < 8) {
    console.warn('ADMIN_BOOTSTRAP_PASSWORD too short; admin bootstrap skipped.');
    return;
  }

  const nowIso = new Date().toISOString();
  const passwordRecord = createPasswordRecord(ADMIN_BOOTSTRAP_PASSWORD);

  usersState.users.push({
    id: randomId(12),
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    role: 'admin',
    passwordSalt: passwordRecord.passwordSalt,
    passwordHash: passwordRecord.passwordHash,
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    autoRenew: false,
    trialGranted: false,
    trialGrantedAt: null,
    trialEndsAt: null,
    notificationsSupportSeenAt: nowIso,
    notificationsNewsSeenAt: nowIso,
    notificationsGeneralSeenAt: nowIso,
    notificationsEvents: [],
    licenseExpiresAt: null,
    currentSessionId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  saveUsersState(usersState);
  console.log(`Bootstrap admin created for ${ADMIN_EMAIL}`);
}

function listAdminUsers() {
  const usersState = loadUsersState();
  const sessionsState = loadSessionsState();
  const activeSessionByUserId = new Set(sessionsState.sessions.map((entry) => entry.userId));

  return usersState.users
    .map((user) => ({
      ...publicUser(user),
      activeSession: activeSessionByUserId.has(user.id),
      updatedAt: user.updatedAt,
    }))
    .sort((a, b) => {
      const left = Date.parse(b.createdAt || '');
      const right = Date.parse(a.createdAt || '');
      return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
    });
}

function saveStripeCustomer(userId, customerId) {
  if (!customerId) {
    return;
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user) {
    return;
  }

  user.stripeCustomerId = customerId;
  user.updatedAt = new Date().toISOString();
  saveUsersState(usersState);
}

function saveSubscriptionStateForUser(userId, subscription) {
  if (!subscription) {
    return null;
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === userId);
  if (!user) {
    return null;
  }

  user.stripeCustomerId = subscription.customer || user.stripeCustomerId || null;
  user.stripeSubscriptionId = subscription.id || user.stripeSubscriptionId || null;
  user.subscriptionStatus = subscription.status || null;
  user.autoRenew = !subscription.cancel_at_period_end;
  applyTrialDataFromSubscription(user, subscription);
  user.licenseExpiresAt = unixToIso(subscription.current_period_end) || user.licenseExpiresAt || null;
  user.updatedAt = new Date().toISOString();

  saveUsersState(usersState);
  return user;
}

function saveSubscriptionStateByLookup(subscription, fallbackUserId = null) {
  if (!subscription) {
    return null;
  }

  const usersState = loadUsersState();
  let user =
    usersState.users.find((entry) => entry.stripeSubscriptionId === subscription.id) ||
    usersState.users.find(
      (entry) => String(entry.stripeCustomerId || '') === String(subscription.customer || ''),
    );

  if (!user && fallbackUserId) {
    user = usersState.users.find((entry) => entry.id === fallbackUserId);
  }

  if (!user) {
    return null;
  }

  user.stripeCustomerId = subscription.customer || user.stripeCustomerId || null;
  user.stripeSubscriptionId = subscription.id || user.stripeSubscriptionId || null;
  user.subscriptionStatus = subscription.status || null;
  user.autoRenew = !subscription.cancel_at_period_end;
  applyTrialDataFromSubscription(user, subscription);
  user.licenseExpiresAt = unixToIso(subscription.current_period_end) || user.licenseExpiresAt || null;
  user.updatedAt = new Date().toISOString();

  saveUsersState(usersState);
  return user;
}

async function syncSubscriptionFromStripeById(subscriptionId, fallbackUserId = null) {
  if (!stripe || !subscriptionId) {
    return null;
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return saveSubscriptionStateByLookup(subscription, fallbackUserId);
}

async function grantLicenseFromCheckoutSession(checkoutSession) {
  if (!checkoutSession) {
    return null;
  }

  const metadata = checkoutSession.metadata || {};
  const userId = metadata.userId || checkoutSession.client_reference_id || null;
  const checkoutSessionId = checkoutSession.id || '';

  if (!userId || !checkoutSessionId) {
    return null;
  }

  const paymentsState = loadPaymentsState();
  if (paymentsState.processedCheckoutSessionIds.includes(checkoutSessionId)) {
    const usersState = loadUsersState();
    return usersState.users.find((entry) => entry.id === userId) || null;
  }

  paymentsState.processedCheckoutSessionIds.push(checkoutSessionId);
  savePaymentsState(paymentsState);

  if (checkoutSession.mode === 'subscription') {
    const paymentStatus = String(checkoutSession.payment_status || '').toLowerCase();
    const paidLike =
      paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
    if (!paidLike) {
      return null;
    }
    if (!checkoutSession.subscription) {
      return null;
    }

    const user = await syncSubscriptionFromStripeById(
      checkoutSession.subscription,
      userId,
    );
    if (user) {
      saveStripeCustomer(user.id, checkoutSession.customer || null);
    }
    return user;
  }

  if (checkoutSession.payment_status !== 'paid') {
    return null;
  }

  const user = grantLicense(userId, LICENSE_DAYS);
  if (user) {
    saveStripeCustomer(user.id, checkoutSession.customer || null);
  }
  return user;
}

async function handleStripeEvent(event) {
  if (event.type === 'checkout.session.completed') {
    const checkoutSession = event.data.object;
    await grantLicenseFromCheckoutSession(checkoutSession);
    return;
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    if (invoice && invoice.subscription) {
      await syncSubscriptionFromStripeById(invoice.subscription);
    }
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    if (invoice && invoice.subscription) {
      await syncSubscriptionFromStripeById(invoice.subscription);
    }
    return;
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    saveSubscriptionStateByLookup(subscription);
    return;
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    saveSubscriptionStateByLookup(subscription);
  }
}

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  let event;

  try {
    if (STRIPE_WEBHOOK_SECRET) {
      const signature = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString('utf8'));
    }
  } catch (error) {
    return res.status(400).send(`Webhook error: ${error.message}`);
  }

  try {
    await handleStripeEvent(event);
    return res.json({ received: true });
  } catch (error) {
    console.error('Stripe event failure', error);
    return res.status(500).json({ error: 'Failed to process event' });
  }
});

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(ROOT_DIR, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/api/config/public', (req, res) => {
  res.json({
    stripeEnabled: Boolean(stripe),
    twintEnabled: ENABLE_TWINT,
    licenseDays: LICENSE_DAYS,
    licensePriceCents: LICENSE_PRICE_CENTS,
    licenseCurrency: LICENSE_CURRENCY,
    subscriptionIntervalDays: SUBSCRIPTION_INTERVAL_DAYS,
    freeTrialDays: FREE_TRIAL_DAYS,
    freeTrialRequiresCard: true,
    autoRenewLocked: AUTO_RENEW_LOCKED,
  });
});

app.post('/api/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  const baseUrl =
    process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (isDisposableEmail(email)) {
    return res.status(400).json({
      error: 'Disposable email addresses are not allowed',
    });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const usersState = loadUsersState();
  const exists = usersState.users.some((entry) => entry.email === email);
  if (exists) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const nowIso = new Date().toISOString();
  const { passwordSalt, passwordHash } = createPasswordRecord(password);

  const user = {
    id: randomId(12),
    email,
    name: name || email.split('@')[0],
    role: 'user',
    passwordSalt,
    passwordHash,
    emailVerified: false,
    emailVerificationToken: null,
    emailVerificationExpiresAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    autoRenew: false,
    trialGranted: false,
    trialGrantedAt: null,
    trialEndsAt: null,
    notificationsSupportSeenAt: nowIso,
    notificationsNewsSeenAt: nowIso,
    notificationsGeneralSeenAt: nowIso,
    notificationsEvents: [],
    licenseExpiresAt: null,
    currentSessionId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const verificationToken = issueEmailVerificationToken(user);
  usersState.users.push(user);
  saveUsersState(usersState);

  const link = verificationLink(baseUrl, verificationToken);
  let emailSent = false;
  try {
    emailSent = await sendVerificationEmail(user, link);
  } catch (error) {
    console.error('Verification email send failed', error);
  }

  return res.status(201).json({
    ok: true,
    verificationRequired: true,
    emailSent,
    message: emailSent
      ? 'Registration successful. Check your inbox to verify your email.'
      : 'Registration successful. Email sending is not configured yet.',
    verificationLink: emailSent ? undefined : link,
  });
});

app.post('/api/auth/resend-verification', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const baseUrl =
    process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

  const safeResponse = {
    ok: true,
    message: 'If the account exists, a verification email has been sent.',
  };

  if (!validateEmail(email)) {
    return res.json(safeResponse);
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.email === email);
  if (!user || user.emailVerified) {
    return res.json(safeResponse);
  }

  const token = issueEmailVerificationToken(user);
  saveUsersState(usersState);

  const link = verificationLink(baseUrl, token);
  let emailSent = false;
  try {
    emailSent = await sendVerificationEmail(user, link);
  } catch (error) {
    console.error('Verification email resend failed', error);
  }

  return res.json({
    ...safeResponse,
    emailSent,
    verificationLink: emailSent ? undefined : link,
  });
});

app.post('/api/auth/verify-email', (req, res) => {
  const token = String(req.body.token || '').trim();
  const result = verifyUserEmailByToken(token);

  if (result.error === 'TOKEN_EXPIRED') {
    return res.status(400).json({ error: 'Verification token expired' });
  }
  if (result.error) {
    return res.status(400).json({ error: 'Invalid verification token' });
  }

  return res.json({
    ok: true,
    message: `Email verified. Add your card to start the ${FREE_TRIAL_DAYS}-day free trial. Then ${(
      LICENSE_PRICE_CENTS / 100
    ).toFixed(2)} ${LICENSE_CURRENCY.toUpperCase()} every ${SUBSCRIPTION_INTERVAL_DAYS} days, cancel anytime.`,
    user: publicUser(result.user),
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.email === email);

  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.emailVerified) {
    return res.status(403).json({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email before logging in.',
    });
  }

  issueSession(user, req, res);
  saveUsersState(usersState);

  return res.json({ user: publicUser(user) });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const safeResponse = {
    ok: true,
    message: 'If the account exists, a reset email has been sent.',
  };

  if (!validateEmail(email)) {
    return res.json(safeResponse);
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.email === email);
  if (!user) {
    return res.json(safeResponse);
  }

  const resetsState = loadPasswordResetsState();
  resetsState.tokens = resetsState.tokens.filter((entry) => entry.userId !== user.id);

  const token = randomId(18);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  resetsState.tokens.push({
    id: randomId(10),
    token,
    userId: user.id,
    createdAt: nowIso,
    expiresAt,
    usedAt: null,
  });
  savePasswordResetsState(resetsState);

  const baseUrl =
    process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const link = passwordResetLink(baseUrl, token);

  try {
    await sendPasswordResetEmail(user, token, link, expiresAt);
  } catch (error) {
    console.error('Password reset email send failed', error);
  }

  return res.json(safeResponse);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const token = String(req.body.token || '').trim();
  const newPassword = String(req.body.newPassword || '');

  if (!token) {
    return res.status(400).json({ error: 'Missing reset token' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const resetsState = loadPasswordResetsState();
  const reset = resetsState.tokens.find((entry) => entry.token === token);
  if (!reset) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === reset.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const passwordRecord = createPasswordRecord(newPassword);
  user.passwordSalt = passwordRecord.passwordSalt;
  user.passwordHash = passwordRecord.passwordHash;
  const changedAt = new Date().toISOString();
  user.updatedAt = changedAt;
  appendUserNotification(user, {
    id: `security_reset_${user.id}_${changedAt}`,
    scope: 'security',
    title: 'Password reset completed',
    body: 'Your password was reset successfully. All active sessions were closed.',
    createdAt: changedAt,
    link: '/settings',
  });
  saveUsersState(usersState);

  revokeSessionByUserId(user.id);

  resetsState.tokens = resetsState.tokens.filter((entry) => entry.userId !== user.id);
  savePasswordResetsState(resetsState);

  try {
    await sendPasswordResetCompletedEmail(user, changedAt);
  } catch (error) {
    console.error('Password reset confirmation email send failed', error);
  }

  return res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  revokeSessionById(cookies[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const context = getAuthContext(req);
  if (!context.user) {
    return res.json({
      authenticated: false,
      reason: context.error || 'NO_SESSION',
    });
  }

  return res.json({
    authenticated: true,
    user: publicUser(context.user),
  });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const notifications = buildNotificationsForUser(user);
  return res.json({
    unreadCount: notifications.unreadCount,
    items: notifications.items.slice(0, 60),
  });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  const scope = String(req.body.scope || 'all').trim().toLowerCase();
  if (
    scope !== 'all' &&
    scope !== 'support' &&
    scope !== 'news' &&
    scope !== 'general' &&
    scope !== 'security' &&
    scope !== 'billing' &&
    scope !== 'system'
  ) {
    return res.status(400).json({ error: 'Invalid scope' });
  }

  const user = markNotificationsAsRead(req.user.id, scope);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const notifications = buildNotificationsForUser(user);
  return res.json({
    ok: true,
    unreadCount: notifications.unreadCount,
  });
});

app.post('/api/coupons/redeem', requireAuth, (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!code) {
    return res.status(400).json({ error: 'Coupon code is required' });
  }

  const result = redeemCouponForUser(req.user.id, code);
  if (result.error === 'COUPON_INVALID') {
    return res.status(400).json({ error: 'Invalid coupon code format' });
  }
  if (result.error === 'COUPON_NOT_FOUND') {
    return res.status(404).json({ error: 'Coupon not found' });
  }
  if (result.error === 'COUPON_INACTIVE') {
    return res.status(409).json({ error: 'Coupon is not active' });
  }
  if (result.error === 'COUPON_EXPIRED') {
    return res.status(409).json({ error: 'Coupon is expired' });
  }
  if (result.error === 'COUPON_EXHAUSTED') {
    return res.status(409).json({ error: 'Coupon redemption limit reached' });
  }
  if (result.error === 'COUPON_ALREADY_USED') {
    return res.status(409).json({ error: 'You already used this coupon' });
  }
  if (result.error === 'USER_NOT_FOUND') {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    ok: true,
    message: `Coupon applied: +${result.daysAdded} days`,
    daysAdded: result.daysAdded,
    licenseExpiresAt: result.licenseExpiresAt,
    coupon: {
      code: result.coupon.code,
      days: result.coupon.days,
    },
    user: publicUser(result.user),
  });
});

app.post('/api/user/profile', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'Name must be between 2 and 80 characters' });
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.name = name;
  user.updatedAt = new Date().toISOString();
  saveUsersState(usersState);

  return res.json({ user: publicUser(user) });
});

app.post('/api/user/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!verifyPassword(currentPassword, user)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const passwordRecord = createPasswordRecord(newPassword);
  user.passwordSalt = passwordRecord.passwordSalt;
  user.passwordHash = passwordRecord.passwordHash;
  const changedAt = new Date().toISOString();
  user.updatedAt = changedAt;
  appendUserNotification(user, {
    id: `security_change_${user.id}_${changedAt}`,
    scope: 'security',
    title: 'Password updated',
    body: 'Your account password was changed successfully.',
    createdAt: changedAt,
    link: '/settings',
  });
  saveUsersState(usersState);

  return res.json({ ok: true });
});

app.get('/api/support/requests/mine', requireAuth, (req, res) => {
  return res.json({ requests: listSupportRequestsForUser(req.user.id) });
});

app.post('/api/support/requests', requireAuth, (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();

  if (subject.length < 3 || subject.length > 120) {
    return res.status(400).json({ error: 'Subject must be between 3 and 120 characters' });
  }

  if (message.length < 10 || message.length > 4000) {
    return res.status(400).json({ error: 'Message must be between 10 and 4000 characters' });
  }

  const attachmentResult = storeSupportAttachment(req.body.attachment);

  if (attachmentResult.error) {
    return res.status(400).json({ error: attachmentResult.error });
  }

  const supportState = loadSupportState();
  const nowIso = new Date().toISOString();
  const request = {
    id: randomId(10),
    userId: req.user.id,
    userName: req.user.name || req.user.email,
    userEmail: req.user.email,
    subject,
    message,
    status: 'open',
    adminReply: null,
    repliedAt: null,
    repliedBy: null,
    attachment: attachmentResult.attachment,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  supportState.requests.push(request);
  saveSupportState(supportState);

  return res.status(201).json({ request: publicSupportRequestForUser(request) });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  return res.json({ users: listAdminUsers() });
});

app.get('/api/admin/support/requests', requireAuth, requireAdmin, (req, res) => {
  return res.json({ requests: listSupportRequestsForAdmin() });
});

app.get('/api/admin/newsletters', requireAuth, requireAdmin, (req, res) => {
  return res.json({
    newsletters: listAdminNewsletters().map(publicNewsletterForUser),
  });
});

app.get('/api/admin/coupons', requireAuth, requireAdmin, (req, res) => {
  return res.json({
    coupons: listAdminCoupons(),
  });
});

app.post('/api/admin/newsletters', requireAuth, requireAdmin, (req, res) => {
  const title = String(req.body.title || '').trim();
  const message = String(req.body.message || '').trim();

  if (title.length < 3 || title.length > 160) {
    return res.status(400).json({ error: 'Title must be between 3 and 160 characters' });
  }
  if (message.length < 10 || message.length > 4000) {
    return res.status(400).json({ error: 'Message must be between 10 and 4000 characters' });
  }

  const newsletter = createNewsletter(req.user, title, message);
  return res.status(201).json({ newsletter: publicNewsletterForUser(newsletter) });
});

app.post('/api/admin/coupons', requireAuth, requireAdmin, (req, res) => {
  const code = normalizeCouponCode(req.body.code);
  const days = Number.parseInt(req.body.days, 10);
  const maxRedemptionsRaw = Number.parseInt(req.body.maxRedemptions, 10);
  const note = String(req.body.note || '').trim();
  const expiresAtRaw = String(req.body.expiresAt || '').trim();

  if (!validCouponCode(code)) {
    return res.status(400).json({ error: 'Code must be 4-40 chars (A-Z, 0-9, -)' });
  }

  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: 'Days must be between 1 and 365' });
  }

  if (Number.isFinite(maxRedemptionsRaw) && maxRedemptionsRaw < 0) {
    return res.status(400).json({ error: 'maxRedemptions must be 0 or higher' });
  }

  if (note.length > 160) {
    return res.status(400).json({ error: 'Note must be 160 characters or fewer' });
  }

  if (expiresAtRaw) {
    const expiresAt = Date.parse(expiresAtRaw);
    if (Number.isNaN(expiresAt)) {
      return res.status(400).json({ error: 'Invalid expiresAt value' });
    }
    if (expiresAt <= Date.now()) {
      return res.status(400).json({ error: 'expiresAt must be in the future' });
    }
  }

  const result = createCoupon(req.user, {
    code,
    days,
    maxRedemptions: Number.isFinite(maxRedemptionsRaw) ? maxRedemptionsRaw : 1,
    note,
    expiresAt: expiresAtRaw || null,
  });

  if (result.error === 'COUPON_EXISTS') {
    return res.status(409).json({ error: 'Coupon code already exists' });
  }

  return res.status(201).json({ coupon: publicCouponForAdmin(result.coupon) });
});

app.post('/api/admin/coupons/:couponId/status', requireAuth, requireAdmin, (req, res) => {
  const couponId = String(req.params.couponId || '').trim();
  if (!couponId) {
    return res.status(400).json({ error: 'Missing couponId' });
  }

  if (typeof req.body.active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }

  const coupon = updateCouponStatus(couponId, req.body.active);
  if (!coupon) {
    return res.status(404).json({ error: 'Coupon not found' });
  }

  return res.json({ coupon: publicCouponForAdmin(coupon) });
});

app.delete('/api/admin/coupons/:couponId', requireAuth, requireAdmin, (req, res) => {
  const couponId = String(req.params.couponId || '').trim();
  if (!couponId) {
    return res.status(400).json({ error: 'Missing couponId' });
  }

  const coupon = deleteCouponById(couponId);
  if (!coupon) {
    return res.status(404).json({ error: 'Coupon not found' });
  }

  return res.json({
    ok: true,
    coupon: {
      id: coupon.id,
      code: coupon.code,
    },
  });
});

app.post('/api/admin/support/requests/:requestId/reply', requireAuth, requireAdmin, (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  const reply = String(req.body.reply || '').trim();
  const statusRaw = String(req.body.status || '')
    .trim()
    .toLowerCase();

  if (!requestId) {
    return res.status(400).json({ error: 'Missing requestId' });
  }

  if (statusRaw && !isValidSupportStatus(statusRaw)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  if (!reply && !statusRaw) {
    return res.status(400).json({ error: 'Provide a reply and/or a status update' });
  }

  const supportState = loadSupportState();
  const request = supportState.requests.find((entry) => entry.id === requestId);
  if (!request) {
    return res.status(404).json({ error: 'Support request not found' });
  }

  const nowIso = new Date().toISOString();

  if (reply) {
    request.adminReply = reply;
    request.repliedAt = nowIso;
    request.repliedBy = req.user.email;
  }

  if (statusRaw) {
    request.status = statusRaw;
  } else if (reply && normalizeSupportStatus(request.status) === 'open') {
    request.status = 'answered';
  }

  request.updatedAt = nowIso;
  saveSupportState(supportState);

  return res.json({ request: publicSupportRequestForAdmin(request) });
});

app.post('/api/admin/users/:userId/license/extend', requireAuth, requireAdmin, (req, res) => {
  const userId = String(req.params.userId || '').trim();
  const daysRaw = Number(req.body.days || LICENSE_DAYS);
  const days = Math.floor(daysRaw);

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return res.status(400).json({ error: 'days must be between 1 and 365' });
  }

  const user = grantLicense(userId, days);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  enqueueUserNotification(user.id, {
    id: `billing_admin_extend_${user.id}_${new Date().toISOString()}`,
    scope: 'billing',
    title: 'License extended',
    body: `An admin extended your access by ${days} day${days === 1 ? '' : 's'}.`,
    createdAt: new Date().toISOString(),
    link: '/settings',
  });

  return res.json({ user: publicUser(user) });
});

app.post('/api/admin/users/:userId/license/revoke', requireAuth, requireAdmin, (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const user = revokeLicense(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  enqueueUserNotification(user.id, {
    id: `billing_admin_revoke_${user.id}_${new Date().toISOString()}`,
    scope: 'billing',
    title: 'License revoked',
    body: 'Your active access was revoked by an admin.',
    createdAt: new Date().toISOString(),
    link: '/settings',
  });

  return res.json({ user: publicUser(user) });
});

app.post('/api/admin/users/:userId/session/revoke', requireAuth, requireAdmin, (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const revoked = revokeSessionByUserId(userId);
  return res.json({ ok: true, revoked });
});

app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, (req, res) => {
  const userId = String(req.params.userId || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const result = deleteUserAccountById(userId, req.user.id);
  if (result.error === 'USER_NOT_FOUND') {
    return res.status(404).json({ error: 'User not found' });
  }
  if (result.error === 'CANNOT_DELETE_SELF') {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (result.error === 'LAST_ADMIN') {
    return res.status(400).json({ error: 'Cannot delete the last admin account' });
  }

  return res.json({ ok: true, user: result.user });
});

app.post('/api/billing/create-checkout-session', requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const usersState = loadUsersState();
  const userRecord = usersState.users.find((entry) => entry.id === req.user.id);
  if (!userRecord) {
    return res.status(404).json({ error: 'User not found' });
  }

  const existingStatus = String(userRecord.subscriptionStatus || '').toLowerCase();
  if (
    userRecord.stripeSubscriptionId &&
    existingStatus &&
    existingStatus !== 'canceled' &&
    existingStatus !== 'incomplete_expired'
  ) {
    return res.status(409).json({
      error: 'Subscription already exists. Manage auto-renew in settings.',
      subscriptionStatus: existingStatus,
    });
  }

  const baseUrl =
    process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

  try {
    const intervalWeeks = Math.max(1, Math.floor(SUBSCRIPTION_INTERVAL_DAYS / 7));
    const trialDaysRaw = Math.max(0, Math.floor(FREE_TRIAL_DAYS));
    const trialEligible =
      trialDaysRaw > 0 &&
      userRecord.emailVerified &&
      !userRecord.trialGranted;
    const trialDays = trialEligible ? trialDaysRaw : 0;

    const checkoutPayload = {
      mode: 'subscription',
      client_reference_id: req.user.id,
      customer: userRecord.stripeCustomerId || undefined,
      customer_email: userRecord.stripeCustomerId ? undefined : req.user.email,
      payment_method_collection: 'always',
      metadata: {
        userId: req.user.id,
        licenseDays: String(LICENSE_DAYS),
        subscriptionIntervalDays: String(SUBSCRIPTION_INTERVAL_DAYS),
        trialDays: String(trialDays),
      },
      subscription_data: {
        metadata: {
          userId: req.user.id,
        },
        trial_period_days: trialDays || undefined,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: LICENSE_CURRENCY,
            unit_amount: LICENSE_PRICE_CENTS,
            recurring: {
              interval: 'week',
              interval_count: intervalWeeks,
            },
            product_data: {
              name: `Tropobank - Subscription ${SUBSCRIPTION_INTERVAL_DAYS} days`,
              description: trialDays
                ? `${trialDays}-day free trial (card required), then CHF 10 every 14 days. Cancel anytime.`
                : 'Full database access. CHF 10 every 14 days. Cancel anytime.',
            },
          },
        },
      ],
      success_url: `${baseUrl}/settings?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/settings?payment=cancel`,
    };

    let session;
    if (ENABLE_TWINT && !trialDays) {
      try {
        session = await stripe.checkout.sessions.create({
          ...checkoutPayload,
          payment_method_types: ['card', 'twint'],
        });
      } catch (twintError) {
        console.warn(`TWINT checkout unavailable, fallback to card: ${twintError.message}`);
        session = await stripe.checkout.sessions.create(checkoutPayload);
      }
    } else {
      session = await stripe.checkout.sessions.create(checkoutPayload);
    }

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error', error);
    return res.status(500).json({ error: 'Cannot create checkout session' });
  }
});

app.get('/api/billing/subscription', requireAuth, (req, res) => {
  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const publicState = publicUser(user);
  return res.json({
    subscription: {
      id: publicState.stripeSubscriptionId,
      status: publicState.subscriptionStatus,
      autoRenew: publicState.autoRenew,
      licenseExpiresAt: publicState.licenseExpiresAt,
      licenseActive: publicState.licenseActive,
      daysRemaining: publicState.daysRemaining,
      amountCents: LICENSE_PRICE_CENTS,
      currency: LICENSE_CURRENCY,
      intervalDays: SUBSCRIPTION_INTERVAL_DAYS,
    },
  });
});

app.post('/api/billing/subscription/auto-renew', requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const enabled = req.body.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  if (AUTO_RENEW_LOCKED && enabled === false) {
    return res.status(400).json({ error: 'Auto-renew must stay enabled on this plan' });
  }

  const usersState = loadUsersState();
  const user = usersState.users.find((entry) => entry.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!user.stripeSubscriptionId) {
    return res.status(400).json({ error: 'No subscription found for this user' });
  }

  try {
    const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: !enabled,
    });

    const updatedUser = saveSubscriptionStateForUser(user.id, subscription);
    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    enqueueUserNotification(updatedUser.id, {
      id: `billing_renewal_${updatedUser.id}_${new Date().toISOString()}`,
      scope: 'billing',
      title: enabled ? 'Auto-renew resumed' : 'Auto-renew canceled',
      body: enabled
        ? 'Your subscription will renew automatically at the end of the current period.'
        : 'Your subscription will end at the current period end unless you resume auto-renew.',
      createdAt: new Date().toISOString(),
      link: '/settings',
    });

    return res.json({
      user: publicUser(updatedUser),
      subscription: {
        id: subscription.id,
        status: subscription.status,
        autoRenew: !subscription.cancel_at_period_end,
        licenseExpiresAt: updatedUser.licenseExpiresAt,
        daysRemaining: getDaysRemaining(updatedUser.licenseExpiresAt),
      },
    });
  } catch (error) {
    console.error('Stripe auto-renew update error', error);
    return res.status(500).json({ error: 'Cannot update auto-renew setting' });
  }
});

app.post('/api/billing/confirm-session', requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const sessionId = String(req.body.sessionId || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
    const metadata = checkoutSession.metadata || {};
    const checkoutUserId =
      metadata.userId || checkoutSession.client_reference_id || null;

    if (checkoutUserId !== req.user.id) {
      return res.status(403).json({ error: 'Checkout session does not belong to this user' });
    }

    const updatedUser = await grantLicenseFromCheckoutSession(checkoutSession);
    if (!updatedUser) {
      return res.status(400).json({ error: 'Payment not completed for this checkout session' });
    }

    enqueueUserNotification(updatedUser.id, {
      id: `billing_checkout_${updatedUser.id}_${new Date().toISOString()}`,
      scope: 'billing',
      title: 'Payment confirmed',
      body: 'Your subscription/payment was confirmed and access is active.',
      createdAt: new Date().toISOString(),
      link: '/settings',
    });

    return res.json({ user: publicUser(updatedUser) });
  } catch (error) {
    console.error('Stripe confirm error', error);
    return res.status(500).json({ error: 'Cannot confirm checkout session' });
  }
});

app.get('/api/questions/search', requireAuth, requireActiveLicense, (req, res) => {
  const query = String(req.query.q || '');
  return res.json(searchQuestions(query));
});

app.get('/api/questions', requireAuth, requireActiveLicense, (req, res) => {
  return res.json(getQuestions());
});

app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'login.html'));
});

app.get('/search', requirePageLogin('/search', 'database'), (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'search.html'));
});

app.get('/support', requirePageLogin('/support', 'support'), (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'support.html'));
});

app.get('/faq', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'faq.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'reset-password.html'));
});

app.get('/verify-email', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'verify-email.html'));
});

app.get('/settings', requirePageLogin('/settings', 'settings'), (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'settings.html'));
});

app.get('/admin', requirePageLogin('/admin', 'admin'), (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'admin.html'));
});

function startServer() {
  ensureStorage();
  ensureAdminUser();
  buildQuestionsCache();

  const preferredPort = Number(process.env.PORT || 3000);
  const maxAttempts = 20;

  const attemptListen = (port, attempt) => {
    const server = app
      .listen(port, () => {
        console.log(`Tropobank server running on http://localhost:${port}`);
      })
      .on('error', (error) => {
        if (error.code === 'EADDRINUSE' && attempt < maxAttempts) {
          const nextPort = port + 1;
          console.warn(`Port ${port} busy, retrying on ${nextPort}`);
          attemptListen(nextPort, attempt + 1);
          return;
        }

        console.error('Server startup failed', error);
        process.exit(1);
      });

    return server;
  };

  attemptListen(preferredPort, 0);
}

startServer();
