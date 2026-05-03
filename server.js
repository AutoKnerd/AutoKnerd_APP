const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const PORT = Number(process.env.PORT || 5173);
const INDEX_PATH = path.join(__dirname, 'index.html');
const MODEL_NAME = 'gemini-2.5-flash';
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCTLbPGP5v2Vu4ahy0XWStVkCUWnYtRxdA';
const MOCK_USER_ID = 'mock-sales-manager';
const SERVER_BOOT_TIME = new Date().toISOString();

const BASE_XP = 100;
const EXPONENT = 1.5;
const BASELINE = 60;
const LAMBDA = Math.log(2) / 30;
const MAX_DELTA_PER_LESSON = 10;
const MAX_CX_AGGRESSIVENESS = 60;
const MIN_CX_AGGRESSIVENESS = 5;
const DEFAULT_CX_AGGRESSIVENESS = 25;
const MIN_CORE_SESSIONS_FOR_FRESH_UP = 3;

const TRAIT_LABELS = {
  empathy: 'Empathy',
  listening: 'Listening',
  trust: 'Trust',
  followUp: 'Follow-Up',
  closing: 'Closing',
  relationship: 'Relationship Building',
};

const ROLE_TONE_PROFILES = {
  sales: {
    tone: 'shopping / exploratory',
    customerMindset: 'curious but cautious',
    typicalConcerns: ['price', 'trade value', 'vehicle reliability', 'monthly payment', 'technology understanding'],
    languageStyle: 'casual conversational',
    conversationLength: 'medium',
    interactionLabel: 'Fresh Up',
    insightLabel: 'Fresh Up Insight',
    summaryLabel: 'Fresh Up Summary',
    prebriefLabel: 'Fresh Up',
    concerns: ['price', 'trade value', 'monthly payment', 'reliability', 'technology confusion', 'safety', 'fuel economy'],
    stages: ['just browsing', 'comparing models', 'trade-in evaluation', 'payment discussion', 'ready to buy'],
    nextStepByRecommended: {
      discovery_lesson: 'discovery_lesson',
      trust_building_lesson: 'trust_building_lesson',
      closing_lesson: 'closing_lesson',
      relationship_lesson: 'relationship_lesson',
      follow_up_lesson: 'follow_up_lesson',
      no_recommendation: 'no_recommendation',
    },
    customScenario: 'A higher-level customer just entered the showroom. This conversation will require stronger listening, trust building, and clarity.',
    exchangeTarget: { min: 6, max: 8 },
  },
  service: {
    tone: 'problem resolution',
    customerMindset: 'time-sensitive and practical',
    typicalConcerns: ['repair cost', 'repair timeline', 'vehicle safety', 'service trust', 'unexpected problems'],
    languageStyle: 'direct and practical',
    conversationLength: 'short-medium',
    interactionLabel: 'Service Interaction',
    insightLabel: 'Service Interaction Insight',
    summaryLabel: 'Service Interaction Summary',
    prebriefLabel: 'Service Interaction',
    concerns: ['repair cost', 'repair timeline', 'urgency', 'warranty coverage', 'trust in diagnosis', 'transportation disruption', 'service clarity'],
    stages: ['appointment check-in', 'diagnosis review', 'repair authorization', 'timeline update', 'ready for pickup'],
    nextStepByRecommended: {
      discovery_lesson: 'write_up_clarity',
      trust_building_lesson: 'repair_trust_language',
      closing_lesson: 'approval_clarity',
      relationship_lesson: 'guest_reassurance',
      follow_up_lesson: 'status_follow_up',
      no_recommendation: 'no_recommendation',
    },
    customScenario: 'A service guest needs clear guidance and confidence in the next repair step. Keep the conversation calm, transparent, and customer-centered.',
    exchangeTarget: { min: 4, max: 6 },
  },
  parts: {
    tone: 'transactional',
    customerMindset: 'specific need',
    typicalConcerns: ['part availability', 'price', 'compatibility', 'installation guidance'],
    languageStyle: 'quick and focused',
    conversationLength: 'short',
    interactionLabel: 'Counter Interaction',
    insightLabel: 'Counter Interaction Insight',
    summaryLabel: 'Counter Interaction Summary',
    prebriefLabel: 'Counter Interaction',
    concerns: ['availability', 'backorder delay', 'price', 'fitment confidence', 'installation timing', 'special order trust'],
    stages: ['availability request', 'fitment confirmation', 'special-order discussion', 'eta update', 'pickup-ready confirmation'],
    nextStepByRecommended: {
      discovery_lesson: 'fitment_discovery',
      trust_building_lesson: 'availability_transparency',
      closing_lesson: 'order_confirmation',
      relationship_lesson: 'counter_rapport',
      follow_up_lesson: 'eta_follow_up',
      no_recommendation: 'no_recommendation',
    },
    customScenario: 'A counter guest needs confidence on fitment, timing, and next steps. Keep explanations clear and set realistic expectations.',
    exchangeTarget: { min: 3, max: 4 },
  },
  fi: {
    tone: 'decision confirmation',
    customerMindset: 'financial caution',
    typicalConcerns: ['budget', 'protection value', 'payment clarity', 'contract understanding'],
    languageStyle: 'analytical but cautious',
    conversationLength: 'medium-long',
    interactionLabel: 'Buyer Review',
    insightLabel: 'Buyer Review Insight',
    summaryLabel: 'Buyer Review Summary',
    prebriefLabel: 'Buyer Review',
    concerns: ['payment structure', 'contract clarity', 'lender approval', 'paperwork stress', 'protection plan trust'],
    stages: ['menu discussion', 'payment structure review', 'lender approval discussion', 'paperwork review', 'signing readiness'],
    nextStepByRecommended: {
      discovery_lesson: 'buyer_needs_review',
      trust_building_lesson: 'finance_transparency',
      closing_lesson: 'signing_confidence',
      relationship_lesson: 'delivery_reassurance',
      follow_up_lesson: 'post_delivery_follow_up',
      no_recommendation: 'no_recommendation',
    },
    customScenario: 'A buyer needs clarity and confidence before signing. Slow down the explanation, check understanding, and guide the next step with trust.',
    exchangeTarget: { min: 6, max: 8 },
  },
};

const ROLE_LESSON_CATEGORIES = {
  'Sales Consultant': [
    'Sales - Meet and Greet',
    'Sales - Needs Assessment',
    'Sales - Vehicle Presentation',
    'Sales - Test Drive',
    'Sales - Negotiation',
    'Sales - Closing',
    'Sales - Delivery',
    'Sales - Follow-up',
    'Product Knowledge',
  ],
  BDC: [
    'Sales - Meet and Greet',
    'Sales - Needs Assessment',
    'Sales - Follow-up',
    'Product Knowledge',
  ],
  'Sales Manager': [
    'Management - Coaching',
    'Management - Performance Review',
  ],
  'Service Writer': [
    'Service - Appointment',
    'Service - Write-up',
    'Service - Walk-around',
    'Service - Presenting MPI',
    'Service - Status Updates',
    'Service - Active Delivery',
    'Product Knowledge',
  ],
  'Service Manager': [
    'Service - Appointment',
    'Service - Write-up',
    'Service - Walk-around',
    'Service - Presenting MPI',
    'Service - Status Updates',
    'Service - Active Delivery',
    'Product Knowledge',
    'Management - Coaching',
    'Management - Performance Review',
  ],
  'Finance Manager': [
    'F&I - Menu Selling',
    'F&I - Objection Handling',
    'Product Knowledge',
  ],
  'Parts Consultant': [
    'Parts - Identifying Needs',
    'Parts - Sourcing',
    'Product Knowledge',
  ],
  'Parts Manager': [
    'Parts - Identifying Needs',
    'Parts - Sourcing',
    'Product Knowledge',
    'Management - Coaching',
    'Management - Performance Review',
  ],
  'General Manager': [
    'Leadership - Team Motivation',
    'Leadership - Conflict Resolution',
    'Operations - Financial Acumen',
    'Operations - Process Improvement',
  ],
  Owner: [
    'Leadership - Team Motivation',
    'Leadership - Conflict Resolution',
    'Operations - Financial Acumen',
    'Operations - Process Improvement',
    'Management - Coaching',
    'Management - Performance Review',
  ],
  Trainer: [
    'Leadership - Team Motivation',
    'Leadership - Conflict Resolution',
    'Operations - Financial Acumen',
    'Operations - Process Improvement',
  ],
  Admin: [
    'Leadership - Team Motivation',
    'Leadership - Conflict Resolution',
    'Operations - Financial Acumen',
    'Operations - Process Improvement',
  ],
  Developer: [],
  manager: [
    'Management - Coaching',
    'Management - Performance Review',
  ],
};

const LESSON_CATEGORY_PROFILES = {
  'Sales - Meet and Greet': {
    title: 'Meet and Greet',
    description: 'Open warmly, build rapport, and earn permission to keep going.',
    microFocus: 'Focus: Warm opening -> comfortable customer.',
  },
  'Sales - Needs Assessment': {
    title: 'Needs Assessment',
    description: 'Uncover the customer\'s priorities before recommending anything.',
    microFocus: 'Focus: Ask first -> recommend second.',
  },
  'Sales - Vehicle Presentation': {
    title: 'Vehicle Presentation',
    description: 'Connect features to the customer\'s stated needs.',
    microFocus: 'Focus: Translate features into value.',
  },
  'Sales - Test Drive': {
    title: 'Test Drive',
    description: 'Guide the experience while staying curious and calm.',
    microFocus: 'Focus: Observe, ask, and match pace.',
  },
  'Sales - Negotiation': {
    title: 'Negotiation',
    description: 'Keep tradeoffs clear and the value conversation grounded.',
    microFocus: 'Focus: Stay steady -> make tradeoffs visible.',
  },
  'Sales - Closing': {
    title: 'Closing',
    description: 'Ask for the decision respectfully and without drift.',
    microFocus: 'Focus: Ask cleanly -> make the next step obvious.',
  },
  'Sales - Delivery': {
    title: 'Delivery',
    description: 'Reinforce confidence and ownership after the sale.',
    microFocus: 'Focus: Confirm confidence and next steps.',
  },
  'Sales - Follow-up': {
    title: 'Follow-Up',
    description: 'Reopen momentum with a helpful, value-based next step.',
    microFocus: 'Focus: Reconnect with purpose.',
  },
  'Service - Appointment': {
    title: 'Appointment',
    description: 'Set expectations, capture the concern, and keep the visit organized.',
    microFocus: 'Focus: Start clear and stay calm.',
  },
  'Service - Write-up': {
    title: 'Write-Up',
    description: 'Gather the issue accurately and explain what happens next.',
    microFocus: 'Focus: Capture details before solutions.',
  },
  'Service - Walk-around': {
    title: 'Walk-Around',
    description: 'Confirm the concern and create trust with careful observation.',
    microFocus: 'Focus: Observe, listen, and reassure.',
  },
  'Service - Presenting MPI': {
    title: 'Presenting MPI',
    description: 'Explain findings clearly and tie them to the customer concern.',
    microFocus: 'Focus: Translate findings into next steps.',
  },
  'Service - Status Updates': {
    title: 'Status Updates',
    description: 'Give calm, timely updates that reduce uncertainty.',
    microFocus: 'Focus: Keep the guest informed.',
  },
  'Service - Active Delivery': {
    title: 'Active Delivery',
    description: 'Close the loop, confirm satisfaction, and set next steps.',
    microFocus: 'Focus: Finish clean and confidently.',
  },
  'Parts - Identifying Needs': {
    title: 'Identifying Needs',
    description: 'Clarify fitment, usage, and the exact part the guest needs.',
    microFocus: 'Focus: Confirm the need before searching.',
  },
  'Parts - Sourcing': {
    title: 'Sourcing',
    description: 'Check availability, timing, and alternatives with accuracy.',
    microFocus: 'Focus: Be precise and realistic.',
  },
  'F&I - Menu Selling': {
    title: 'Menu Selling',
    description: 'Present protection options clearly while staying human and compliant.',
    microFocus: 'Focus: Clarify value without pressure.',
  },
  'F&I - Objection Handling': {
    title: 'Objection Handling',
    description: 'Respond to budget and trust concerns without rushing.',
    microFocus: 'Focus: Slow down and address the real concern.',
  },
  'Management - Coaching': {
    title: 'Coaching',
    description: 'Give direct feedback that improves the next rep.',
    microFocus: 'Focus: Coach the behavior, not the person.',
  },
  'Management - Performance Review': {
    title: 'Performance Review',
    description: 'Discuss results and next steps with clarity and accountability.',
    microFocus: 'Focus: Be fair, specific, and actionable.',
  },
  'Leadership - Team Motivation': {
    title: 'Team Motivation',
    description: 'Set direction and energy without sounding generic.',
    microFocus: 'Focus: Lead with clarity and purpose.',
  },
  'Leadership - Conflict Resolution': {
    title: 'Conflict Resolution',
    description: 'Keep the conversation steady, fair, and outcome-focused.',
    microFocus: 'Focus: Reduce tension and define a path forward.',
  },
  'Operations - Financial Acumen': {
    title: 'Financial Acumen',
    description: 'Connect the numbers to store health and smart decisions.',
    microFocus: 'Focus: Make the business case clear.',
  },
  'Operations - Process Improvement': {
    title: 'Process Improvement',
    description: 'Identify friction and tighten the workflow.',
    microFocus: 'Focus: Fix the process, not just the moment.',
  },
  'Product Knowledge': {
    title: 'Product Knowledge',
    description: 'Explain the product clearly and tie details to real value.',
    microFocus: 'Focus: Teach without overwhelming.',
  },
};

const ROLE_SCOPE_RANK = {
  manager_and_under: 1,
  general_manager_and_under: 2,
  owner_and_under: 3,
};

const ROLE_SCOPE_ORDER = [
  'owner_and_under',
  'general_manager_and_under',
  'manager_and_under',
];

const MAX_SCOPE_BY_ROLE = {
  Developer: 'owner_and_under',
  Admin: 'owner_and_under',
  Trainer: 'general_manager_and_under',
  Owner: 'general_manager_and_under',
  'General Manager': 'manager_and_under',
  manager: 'manager_and_under',
  'Sales Manager': 'manager_and_under',
  'Service Manager': 'manager_and_under',
  'Parts Manager': 'manager_and_under',
  'Finance Manager': 'manager_and_under',
};

const ROLES_BY_SCOPE = {
  owner_and_under: [
    'Owner',
    'General Manager',
    'manager',
    'Sales Manager',
    'Service Manager',
    'Parts Manager',
    'Finance Manager',
    'Sales Consultant',
    'BDC',
    'Service Writer',
    'Parts Consultant',
  ],
  general_manager_and_under: [
    'General Manager',
    'manager',
    'Sales Manager',
    'Service Manager',
    'Parts Manager',
    'Finance Manager',
    'Sales Consultant',
    'BDC',
    'Service Writer',
    'Parts Consultant',
  ],
  manager_and_under: [
    'manager',
    'Sales Manager',
    'Service Manager',
    'Parts Manager',
    'Finance Manager',
    'Sales Consultant',
    'BDC',
    'Service Writer',
    'Parts Consultant',
  ],
};

const activeSessions = new Map();
const authSessions = new Map();
const developerDashboardCache = new Map();
const DEVELOPER_DASHBOARD_CACHE_TTL_MS = 5000;
let firebaseDb = null;

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLookupValue(value) {
  return String(value || '').trim();
}

function createAuthSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  authSessions.set(token, {
    userId,
    createdAt: Date.now(),
  });
  return token;
}

function getAuthSession(token) {
  if (!token) return null;
  return authSessions.get(String(token).trim()) || null;
}

function clearAuthSession(token) {
  if (!token) return;
  authSessions.delete(String(token).trim());
}

function getRequestToken(req, url, body = {}) {
  const headerToken = req.headers['x-autoknerd-token'] || req.headers['x-autoknerd-auth'];
  return String(headerToken || body.token || url.searchParams.get('token') || '').trim();
}

function getAuthUserId(req, url, body = {}) {
  const token = getRequestToken(req, url, body);
  const session = getAuthSession(token);
  return session?.userId || '';
}

function clampScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric)) : BASELINE;
}

function calculateLevel(xp) {
  const safeXp = Number.isFinite(Number(xp)) ? Number(xp) : 0;
  if (safeXp < 0) return { level: 1, levelXp: 0, nextLevelXp: BASE_XP, progress: 0 };

  let level = 1;
  let requiredXp = 0;

  while (true) {
    const xpForNextLevel = requiredXp + Math.floor(BASE_XP * Math.pow(level, EXPONENT));
    if (safeXp < xpForNextLevel) break;
    requiredXp = xpForNextLevel;
    level += 1;
    if (level > 100) {
      level = 100;
      break;
    }
  }

  if (level >= 100) {
    const totalXpForLevel99 = Math.floor(BASE_XP * Math.pow(99, EXPONENT));
    const currentLevelXp = safeXp - totalXpForLevel99;
    return { level: 100, levelXp: currentLevelXp, nextLevelXp: currentLevelXp, progress: 100 };
  }

  const xpForCurrentLevel = requiredXp;
  const xpForNextLevel = Math.floor(BASE_XP * Math.pow(level, EXPONENT));
  const currentLevelXp = safeXp - xpForCurrentLevel;
  const progress = Math.floor((currentLevelXp / xpForNextLevel) * 100);

  return {
    level,
    levelXp: currentLevelXp,
    nextLevelXp: xpForNextLevel,
    progress,
    totalXpForNextLevel: xpForCurrentLevel + xpForNextLevel,
  };
}

function getDefaultStats() {
  return {
    empathy: { score: BASELINE, lastUpdated: null },
    listening: { score: BASELINE, lastUpdated: null },
    trust: { score: BASELINE, lastUpdated: null },
    followUp: { score: BASELINE, lastUpdated: null },
    closing: { score: BASELINE, lastUpdated: null },
    relationship: { score: BASELINE, lastUpdated: null },
  };
}

function normalizeStats(stats) {
  const source = stats && typeof stats === 'object' ? stats : {};
  const defaults = getDefaultStats();
  const keys = ['empathy', 'listening', 'trust', 'followUp', 'closing', 'relationship'];

  const result = {};
  for (const key of keys) {
    const value = source[key];
    let score = defaults[key].score;
    let lastUpdated = null;

    if (typeof value === 'number' && Number.isFinite(value)) {
      score = clampScore(value);
    } else if (value && typeof value === 'object') {
      if (typeof value.score === 'number' && Number.isFinite(value.score)) {
        score = clampScore(value.score);
      }
      if (value.lastUpdated) {
        lastUpdated = toIso(value.lastUpdated);
      }
    }

    result[key] = { score, lastUpdated };
  }

  return result;
}

function extractStatScore(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return clampScore(value);
  if (value && typeof value === 'object' && typeof value.score === 'number' && Number.isFinite(value.score)) {
    return clampScore(value.score);
  }
  return null;
}

function scoreFromStats(stats) {
  if (!stats) return 0;
  const values = [
    extractStatScore(stats.empathy),
    extractStatScore(stats.listening),
    extractStatScore(stats.trust),
    extractStatScore(stats.followUp),
    extractStatScore(stats.closing),
    extractStatScore(stats.relationship),
  ].filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function getTraitScores(stats) {
  return {
    empathy: extractStatScore(stats?.empathy) ?? BASELINE,
    listening: extractStatScore(stats?.listening) ?? BASELINE,
    trust: extractStatScore(stats?.trust) ?? BASELINE,
    followUp: extractStatScore(stats?.followUp) ?? BASELINE,
    closing: extractStatScore(stats?.closing) ?? BASELINE,
    relationship: extractStatScore(stats?.relationship) ?? BASELINE,
  };
}

function weakestTrait(stats) {
  const scores = getTraitScores(stats);
  return Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0];
}

function strongestTrait(stats) {
  const scores = getTraitScores(stats);
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function calculateStreak(dates) {
  if (!dates.length) return 0;
  const daySet = new Set(
    dates.map((value) => {
      const date = new Date(value);
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    })
  );

  let streak = 0;
  const cursor = new Date();
  while (true) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    if (!daySet.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function normalizeCxAggressiveness(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CX_AGGRESSIVENESS;
  return Math.max(MIN_CX_AGGRESSIVENESS, Math.min(MAX_CX_AGGRESSIVENESS, Math.round(numeric)));
}

function clampDelta(value) {
  return Math.max(-MAX_DELTA_PER_LESSON, Math.min(MAX_DELTA_PER_LESSON, value));
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value.toDate === 'function') {
    const converted = value.toDate();
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) return converted;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function normalizeStoredRecentSessions(recentSessions, recentSession) {
  const entries = [];
  if (Array.isArray(recentSessions)) {
    entries.push(...recentSessions);
  }
  if (recentSession && typeof recentSession === 'object') {
    entries.push(recentSession);
  }

  return entries
    .map((session) => {
      const timestamp = session?.timestamp || session?.createdAt || session?.updatedAt || null;
      const isoTimestamp = toIso(timestamp) || (typeof timestamp === 'string' ? timestamp : null);
      return {
        title: String(session?.title || session?.lessonTitle || session?.sessionTitle || session?.lessonCategory || 'Session').trim(),
        timestamp: isoTimestamp,
        score: Number(session?.score || session?.xpGained || session?.xp || 0),
        lessonCategory: String(session?.lessonCategory || session?.lessonTitle || '').trim(),
        activitySource: String(session?.activitySource || 'core').trim(),
      };
    })
    .filter((session) => session.title || session.timestamp)
    .slice(0, 3);
}

function getDeveloperDashboardCacheKey({
  currentUserId = '',
  roleProfile = null,
  mockMode = false,
  mockRoleOverride = '',
  dealershipId = '',
} = {}) {
  return [
    'developer-dashboard',
    currentUserId || 'anonymous',
    roleProfile?.roleLabel || 'Developer',
    roleProfile?.roleType || 'unknown',
    isTruthyFlag(mockMode) ? 'mock' : 'live',
    String(mockRoleOverride || '').trim() || 'default',
    String(dealershipId || '').trim() || 'all',
  ].join(':');
}

function getDeveloperDashboardCache(cacheKey) {
  const entry = developerDashboardCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > DEVELOPER_DASHBOARD_CACHE_TTL_MS) {
    developerDashboardCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function setDeveloperDashboardCache(cacheKey, payload) {
  developerDashboardCache.set(cacheKey, {
    createdAt: Date.now(),
    payload,
  });
}

function dateKey(date) {
  const source = date instanceof Date ? date : new Date(date);
  const year = source.getFullYear();
  const month = String(source.getMonth() + 1).padStart(2, '0');
  const day = String(source.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function hashSeed(input) {
  let hash = 0;
  const source = String(input || '');
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function userHash(userId) {
  const hashed = hashSeed(userId).toString(36);
  return hashed.slice(0, 8) || 'user';
}

function formatShortDate(value) {
  const date = toDate(value);
  if (!date) return 'Recently';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getStreakBonus(now, priorLogs) {
  const priorCoreLogs = priorLogs.filter((log) => log.activitySource === 'core');
  if (!priorCoreLogs.length) return 0;
  const mostRecent = priorCoreLogs[0];
  const dayGap = differenceInCalendarDays(startOfDay(now), startOfDay(mostRecent.timestamp));
  return dayGap === 1 ? 20 : 0;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function differenceInCalendarDays(left, right) {
  const startLeft = startOfDay(left);
  const startRight = startOfDay(right);
  return Math.round((startLeft.getTime() - startRight.getTime()) / (24 * 60 * 60 * 1000));
}

function computeUpMeterIncrement(ratingsAverage, streakBonus = 0) {
  const base = ratingsAverage >= 85 ? 18 : ratingsAverage <= 65 ? 12 : 15;
  return base + streakBonus;
}

function maybeUnlockFreshUp(currentMeter) {
  if (currentMeter >= 100) return true;
  if (currentMeter >= 80) return Math.random() < 0.5;
  if (currentMeter >= 60) return Math.random() < 0.2;
  return false;
}

function buildNextFreshUpState({ user, now, priorLogs, ratings, activitySource, lessonId }) {
  const currentMeter = Math.max(0, Math.round(Number(user.freshUpMeter ?? 0)));
  const currentAvailable = user.freshUpAvailable === true;
  const currentCoreSessionsSinceLast = Math.max(0, Math.round(Number(user.freshUpCoreSessionsSinceLast ?? 0)));
  const isFreshUp = activitySource === 'fresh-up' || lessonId === 'fresh-up';

  if (isFreshUp) {
    return {
      freshUpMeter: Math.max(0, currentMeter - 100),
      freshUpAvailable: false,
      freshUpLastTriggeredAt: user.freshUpLastTriggeredAt ?? null,
      freshUpLastCompletedAt: now.toISOString(),
      freshUpCompletedCount: Math.max(0, Number(user.freshUpCompletedCount ?? 0)) + 1,
      freshUpCoreSessionsSinceLast: 0,
    };
  }

  if (activitySource !== 'core') {
    return {
      freshUpMeter: currentMeter,
      freshUpAvailable: currentAvailable,
      freshUpLastTriggeredAt: user.freshUpLastTriggeredAt ?? null,
      freshUpLastCompletedAt: user.freshUpLastCompletedAt ?? null,
      freshUpCompletedCount: Math.max(0, Number(user.freshUpCompletedCount ?? 0)),
      freshUpCoreSessionsSinceLast: currentCoreSessionsSinceLast,
    };
  }

  const averageRating = Math.round((
    ratings.empathy +
    ratings.listening +
    ratings.trust +
    ratings.followUp +
    ratings.closing +
    ratings.relationship
  ) / 6);
  const streakBonus = getStreakBonus(now, priorLogs);
  const nextMeter = currentMeter + computeUpMeterIncrement(averageRating, streakBonus);
  const nextCoreSessionsSinceLast = currentCoreSessionsSinceLast + 1;
  const eligibleForUnlock = nextCoreSessionsSinceLast >= MIN_CORE_SESSIONS_FOR_FRESH_UP;
  const unlocked = currentAvailable || (eligibleForUnlock && maybeUnlockFreshUp(nextMeter));

  return {
    freshUpMeter: nextMeter,
    freshUpAvailable: unlocked,
    freshUpLastTriggeredAt: unlocked && !currentAvailable ? now.toISOString() : (user.freshUpLastTriggeredAt ?? null),
    freshUpLastCompletedAt: user.freshUpLastCompletedAt ?? null,
    freshUpCompletedCount: Math.max(0, Number(user.freshUpCompletedCount ?? 0)),
    freshUpCoreSessionsSinceLast: nextCoreSessionsSinceLast,
  };
}

function getRoleLessonCategories(roleLabel, roleType) {
  const normalized = normalizeRoleLabel(roleLabel);
  if (Array.isArray(ROLE_LESSON_CATEGORIES[normalized]) && ROLE_LESSON_CATEGORIES[normalized].length) {
    return [...ROLE_LESSON_CATEGORIES[normalized]];
  }
  if (normalized === 'manager') return [...ROLE_LESSON_CATEGORIES['Sales Manager']];
  if (roleType === 'service') return [...ROLE_LESSON_CATEGORIES['Service Writer']];
  if (roleType === 'parts') return [...ROLE_LESSON_CATEGORIES['Parts Consultant']];
  if (roleType === 'fi') return [...ROLE_LESSON_CATEGORIES['Finance Manager']];
  return [...ROLE_LESSON_CATEGORIES['Sales Consultant']];
}

function pickRoleLessonCategory(roleLabel, roleType, trait, key) {
  const categories = getRoleLessonCategories(roleLabel, roleType);
  if (!categories.length) return 'Product Knowledge';
  const seed = `${normalizeRoleLabel(roleLabel)}:${roleType}:${trait}:${key}:lesson-category`;
  return categories[hashSeed(seed) % categories.length];
}

function getLessonCategoryProfile(category) {
  return LESSON_CATEGORY_PROFILES[category] || null;
}

function buildLessonLibrary(roleLabel, roleType, trait, currentCategory = null) {
  const categories = getRoleLessonCategories(roleLabel, roleType);
  const resolvedCurrent = currentCategory || pickRoleLessonCategory(roleLabel, roleType, trait, `${normalizeRoleLabel(roleLabel)}:lesson-library`);
  const ordered = [
    resolvedCurrent,
    ...categories.filter((category) => category !== resolvedCurrent),
  ].filter(Boolean);

  return ordered.map((category, index) => {
    const profile = getLessonCategoryProfile(category) || {
      title: category,
      description: 'Role-specific customer conversation practice.',
      microFocus: 'Focus: Keep the rep practical and customer-first.',
    };
    return {
      category,
      title: profile.title || category,
      description: profile.description || 'Role-specific customer conversation practice.',
      microFocus: profile.microFocus || 'Focus: Keep the rep practical and customer-first.',
      recommended: index < 3 || category === resolvedCurrent,
      current: category === resolvedCurrent,
    };
  });
}

function buildMissionFocus(trait, role, lessonCategory) {
  const map = {
    empathy: {
      title: 'Lead Qualification',
      description: `Focus: Lead Qualification → helps build trust faster`,
      mission: `Open strong, slow down the intro, and make the customer feel heard.`,
    },
    listening: {
      title: 'Discovery',
      description: `Focus: Discovery → surfaces what matters before you pitch`,
      mission: `Ask one calm question, then reflect the answer before moving forward.`,
    },
    trust: {
      title: 'Trust Building',
      description: `Focus: Trust Building → reduces friction before the ask`,
      mission: `Acknowledge the concern first, then guide the next step with clarity.`,
    },
    followUp: {
      title: 'Next Step Clarity',
      description: `Focus: Next Step Clarity → keeps the session moving`,
      mission: `Set one realistic next step and make the timeline feel easy to follow.`,
    },
    closing: {
      title: 'Closing Confidence',
      description: `Focus: Closing Confidence → helps you ask cleanly`,
      mission: `Make the ask direct, respectful, and easy for the customer to answer.`,
    },
    relationship: {
      title: 'Relationship Building',
      description: `Focus: Relationship Building → makes the conversation feel human`,
      mission: `Use one personal, relevant detail so the customer feels remembered.`,
    },
  };

  const categoryProfile = getLessonCategoryProfile(lessonCategory);
  const resolved = categoryProfile || map[trait] || map.trust;
  return {
    phaseTitle: `${normalizeRoleLabel(role)} Phase III`,
    title: resolved.title,
    lessonTitle: resolved.title,
    description: categoryProfile ? resolved.description : resolved.mission,
    microFocus: categoryProfile ? resolved.microFocus : resolved.description,
  };
}

function buildManagerTodayFocus(roleProfile, focusTrait, seedKey) {
  const normalizedRole = normalizeRoleLabel(roleProfile?.roleLabel || 'Sales Consultant');
  const roleType = roleProfile?.roleType || resolveAisRoleType(normalizedRole);
  const categories = getRoleLessonCategories(normalizedRole, roleType);
  const isStoreLeader = ['General Manager', 'Owner', 'Trainer', 'Admin', 'Developer'].includes(normalizedRole);
  const isFloorManager = normalizedRole === 'manager' || normalizedRole.endsWith(' Manager');
  const preferredCategories = categories.filter((category) => {
    if (isFloorManager) return category.startsWith('Management -');
    if (isStoreLeader) return category.startsWith('Leadership -') || category.startsWith('Operations -');
    return true;
  });
  const fallbackCategory = preferredCategories[0] || categories[0] || 'Product Knowledge';
  const chosenCategory = preferredCategories.length
    ? preferredCategories[hashSeed(`${normalizedRole}:${roleType}:${focusTrait}:${seedKey}:today-focus`) % preferredCategories.length]
    : fallbackCategory;
  const focus = buildMissionFocus(focusTrait, normalizedRole, chosenCategory);

  return {
    ...focus,
    lessonCategory: chosenCategory,
    lessonTitle: focus.lessonTitle || focus.title || chosenCategory,
  };
}

function normalizeRoleLabel(role) {
  const value = String(role || '').trim();
  if (!value) return 'Sales Consultant';
  if (value === 'manager') return 'Sales Manager';
  return value;
}

function normalizeDeveloperRoleOverride(role) {
  const value = String(role || '').trim();
  if (!value) return null;
  const normalized = normalizeRoleLabel(value);
  const allowed = new Set([
    'Sales Consultant',
    'BDC',
    'Service Writer',
    'Parts Consultant',
    'Finance Manager',
    'Sales Manager',
    'Service Manager',
    'Parts Manager',
    'General Manager',
    'Owner',
    'Trainer',
    'Admin',
    'Developer',
  ]);
  return allowed.has(normalized) ? normalized : null;
}

function resolveAisRoleType(userRole) {
  const role = normalizeRoleLabel(userRole);
  if (role === 'Service Writer' || role === 'Service Manager') return 'service';
  if (role === 'Parts Consultant' || role === 'Parts Manager') return 'parts';
  if (role === 'Finance Manager') return 'fi';
  return 'sales';
}

function getRoleExchangeTarget(roleType) {
  return ROLE_TONE_PROFILES[roleType]?.exchangeTarget || ROLE_TONE_PROFILES.sales.exchangeTarget;
}

function getRoleTurnTargets(roleType) {
  const target = getRoleExchangeTarget(roleType);
  return {
    minUserExchanges: target.min,
    maxUserExchanges: target.max,
    minTotalTurns: target.min * 2,
    maxTotalTurns: target.max * 2,
  };
}

function getRoleTheme(roleType) {
  return ROLE_TONE_PROFILES[roleType] || ROLE_TONE_PROFILES.sales;
}

function getMaxEnrollmentScopeForInviter(role) {
  return MAX_SCOPE_BY_ROLE[normalizeRoleLabel(role)] || null;
}

function canUseEnrollmentScope(inviterRole, scope) {
  const maxScope = getMaxEnrollmentScopeForInviter(inviterRole);
  if (!maxScope) return false;
  return ROLE_SCOPE_RANK[scope] <= ROLE_SCOPE_RANK[maxScope];
}

function getAvailableEnrollmentScopesForInviter(role) {
  const maxScope = getMaxEnrollmentScopeForInviter(role);
  if (!maxScope) return [];
  return ROLE_SCOPE_ORDER.filter((scope) => ROLE_SCOPE_RANK[scope] <= ROLE_SCOPE_RANK[maxScope]);
}

function getAllowedEnrollmentRolesForScope(scope) {
  return [...(ROLES_BY_SCOPE[scope] || [])];
}

function getEnrollmentScopeLabel(scope) {
  switch (scope) {
    case 'owner_and_under':
      return 'Owner and under';
    case 'general_manager_and_under':
      return 'General Manager and under';
    case 'manager_and_under':
    default:
      return 'Managers and under';
  }
}

function getEnrollmentScopeDescription(scope) {
  switch (scope) {
    case 'owner_and_under':
      return 'Allows Owner, General Manager, all manager roles, and frontline roles.';
    case 'general_manager_and_under':
      return 'Allows General Manager, all manager roles, and frontline roles.';
    case 'manager_and_under':
      return 'Allows manager roles and frontline roles.';
    default:
      return '';
  }
}

function getVisibilityScopeForRole(role) {
  const roleLabel = normalizeRoleLabel(role);
  if (['Developer', 'Admin'].includes(roleLabel)) return 'group';
  if (['Owner', 'General Manager'].includes(roleLabel)) return 'dealer';
  if (['Sales Manager', 'Service Manager', 'Parts Manager', 'manager'].includes(roleLabel)) return 'team';
  return 'self';
}

function getVisibilityScopeLabel(scope) {
  switch (scope) {
    case 'group':
      return 'Group';
    case 'dealer':
      return 'Dealer';
    case 'team':
      return 'Team';
    case 'self':
    default:
      return 'Self';
  }
}

function getVisibilityScopeDescription(scope) {
  switch (scope) {
    case 'group':
      return 'Can see the full live organization.';
    case 'dealer':
      return 'Can see all users assigned to the dealer(s) in scope.';
    case 'team':
      return 'Can see direct reports and team members in scope.';
    case 'self':
    default:
      return 'Can only see their own data.';
  }
}

function getRoleProfile(role) {
  const roleLabel = normalizeRoleLabel(role);
  const roleType = resolveAisRoleType(roleLabel);
  const roleTheme = getRoleTheme(roleType);
  const maxEnrollmentScope = getMaxEnrollmentScopeForInviter(roleLabel);
  return {
    roleLabel,
    roleType,
    visibilityScope: getVisibilityScopeForRole(roleLabel),
    visibilityScopeLabel: getVisibilityScopeLabel(getVisibilityScopeForRole(roleLabel)),
    visibilityScopeDescription: getVisibilityScopeDescription(getVisibilityScopeForRole(roleLabel)),
    roleTone: roleTheme.tone,
    customerMindset: roleTheme.customerMindset,
    languageStyle: roleTheme.languageStyle,
    conversationLength: roleTheme.conversationLength,
    interactionLabel: roleTheme.interactionLabel,
    insightLabel: roleTheme.insightLabel,
    summaryLabel: roleTheme.summaryLabel,
    prebriefLabel: roleTheme.prebriefLabel,
    concerns: [...(roleTheme.concerns || roleTheme.typicalConcerns || [])],
    stages: [...(roleTheme.stages || [])],
    nextStepByRecommended: { ...(roleTheme.nextStepByRecommended || {}) },
    customScenario: roleTheme.customScenario,
    exchangeTarget: { ...(roleTheme.exchangeTarget || getRoleExchangeTarget(roleType)) },
    maxEnrollmentScope,
    availableEnrollmentScopes: getAvailableEnrollmentScopesForInviter(roleLabel),
    allowedEnrollmentRoles: maxEnrollmentScope ? getAllowedEnrollmentRolesForScope(maxEnrollmentScope) : [],
    enrollmentScopeLabel: maxEnrollmentScope ? getEnrollmentScopeLabel(maxEnrollmentScope) : null,
    enrollmentScopeDescription: maxEnrollmentScope ? getEnrollmentScopeDescription(maxEnrollmentScope) : null,
  };
}

function getFreshUpExperience(roleLabel, roleType) {
  const normalized = normalizeRoleLabel(roleLabel);
  const systemLabelByRole = {
    'Sales Consultant': 'Fresh Up',
    'Sales Manager': 'Fresh Up',
    manager: 'Fresh Up',
    'Service Writer': 'Fresh Drive In',
    'Service Manager': 'Fresh Drive In',
    'Parts Consultant': 'Fresh Counter',
    'Parts Manager': 'Fresh Counter',
    'Finance Manager': 'Fresh Menu',
    'General Manager': 'Leadership',
    Owner: 'Leadership',
    Trainer: 'Leadership',
    Admin: 'Leadership',
    Developer: 'Leadership',
  };
  const fallbackSystemLabel = roleType === 'service'
    ? 'Fresh Drive In'
    : roleType === 'parts'
      ? 'Fresh Counter'
      : roleType === 'fi'
        ? 'Fresh Menu'
        : 'Fresh Up';
  const systemLabel = systemLabelByRole[normalized] || fallbackSystemLabel;
  const experienceByRole = {
    'Sales Consultant': {
      audience: 'customer',
      customerName: 'Customer',
      customerOpening: 'I like the vehicle, but I still need to feel completely confident before I move forward.',
      coachLine: 'Slow the opening down. Keep it trust-first and customer-centered.',
      customerConcern: 'customer confidence',
      scenarioSummary: 'A live customer is unsure and needs a calm, trust-first response before moving forward.',
    },
    'Sales Manager': {
      audience: 'manager',
      customerName: 'Consultant',
      customerOpening: 'My consultant is stuck with a customer and I need help coaching them without taking over.',
      coachLine: 'Coach the consultant through the customer challenge and help them stay calm, specific, and in control.',
      customerConcern: 'consultant coaching',
      scenarioSummary: 'A consultant is struggling with a customer, and you need to lead without taking over the deal.',
    },
    manager: {
      audience: 'manager',
      customerName: 'Consultant',
      customerOpening: 'My consultant is stuck with a customer and I need help coaching them without taking over.',
      coachLine: 'Coach the consultant through the customer challenge and help them stay calm, specific, and in control.',
      customerConcern: 'consultant coaching',
      scenarioSummary: 'A consultant is struggling with a customer, and you need to lead without taking over the deal.',
    },
    'Service Writer': {
      audience: 'customer',
      customerName: 'Customer',
      customerOpening: 'I need a real update and I am frustrated about how long this is taking.',
      coachLine: 'Stay calm and specific. The customer needs clarity, not excuses.',
      customerConcern: 'repair update',
      scenarioSummary: 'A service customer is challenging the wait time and needs a clear, calm update.',
    },
    'Service Manager': {
      audience: 'manager',
      customerName: 'Advisor',
      customerOpening: 'My advisor is stuck with a frustrated guest and the lane is backing up. I need a better way to handle it.',
      coachLine: 'Lead the lane better. Give the team structure, keep the guest calm, and manage the next step cleanly.',
      customerConcern: 'lane management',
      scenarioSummary: 'You are coaching the service team through a tough guest and a backed-up lane.',
    },
    'Parts Consultant': {
      audience: 'customer',
      customerName: 'Customer',
      customerOpening: 'I need the right part, the right price, and a clear answer on timing.',
      coachLine: 'Be crisp and confident. Clear answers win the counter.',
      customerConcern: 'part availability',
      scenarioSummary: 'A parts customer needs quick, clear answers on fitment, pricing, and timing.',
    },
    'Parts Manager': {
      audience: 'manager',
      customerName: 'Counter Rep',
      customerOpening: 'My counter rep is struggling to keep customers informed, and the line is getting backed up.',
      coachLine: 'Run the counter better. Tighten communication, remove friction, and keep the team moving.',
      customerConcern: 'counter flow',
      scenarioSummary: 'You are coaching the parts team to handle backlog, communication, and timing with more control.',
    },
    'Finance Manager': {
      audience: 'customer',
      customerName: 'Buyer',
      customerOpening: 'The numbers need to make sense before I sign anything.',
      coachLine: 'Keep the numbers clear and the process calm.',
      customerConcern: 'payment clarity',
      scenarioSummary: 'A buyer needs clarity and confidence before moving forward with the menu and paperwork.',
    },
    'General Manager': {
      audience: 'manager',
      customerName: 'Team Lead',
      customerOpening: 'The store needs a clearer standard, and I need help leading the team through it.',
      coachLine: 'Keep the coaching simple, visible, and aligned around the next best team habit.',
      customerConcern: 'team alignment',
      scenarioSummary: 'You are coaching the store through leadership, clarity, and consistency across departments.',
    },
    Owner: {
      audience: 'manager',
      customerName: 'Team Lead',
      customerOpening: 'I need a better way to make sure the team stays aligned without slowing the store down.',
      coachLine: 'Keep the leadership message simple and focused on standards, accountability, and momentum.',
      customerConcern: 'store alignment',
      scenarioSummary: 'You are shaping leadership behavior so the whole store stays aligned and accountable.',
    },
    Trainer: {
      audience: 'manager',
      customerName: 'Team Lead',
      customerOpening: 'I want the team to keep the standard, but I need a better way to teach it.',
      coachLine: 'Teach the behavior, protect the standard, and make the next rep easy to repeat.',
      customerConcern: 'training clarity',
      scenarioSummary: 'You are coaching how to teach the standard so the team can repeat it under pressure.',
    },
    Admin: {
      audience: 'manager',
      customerName: 'Team Lead',
      customerOpening: 'The process is getting messy and I need a better way to keep the team on track.',
      coachLine: 'Keep the process clear and the expectations visible so the team can execute cleanly.',
      customerConcern: 'process clarity',
      scenarioSummary: 'You are helping the team tighten process, clarity, and accountability.',
    },
    Developer: {
      audience: 'manager',
      customerName: 'Team Lead',
      customerOpening: 'I need the flow to stay clean while the team keeps moving.',
      coachLine: 'Keep the system clear, the behavior repeatable, and the next step easy to follow.',
      customerConcern: 'system clarity',
      scenarioSummary: 'You are coaching behavior and process so the team can move cleanly through the flow.',
    },
  };
  const fallback = {
    audience: roleType === 'service' || roleType === 'parts' ? 'customer' : 'manager',
    customerName: roleType === 'service' ? 'Customer' : roleType === 'parts' ? 'Customer' : 'Consultant',
    customerOpening: roleType === 'service'
      ? 'I need a real update and I am frustrated about how long this is taking.'
      : roleType === 'parts'
        ? 'I need the right part, the right price, and a clear answer on timing.'
        : 'I need help getting this customer moving in the right direction.',
    coachLine: roleType === 'service'
      ? 'Stay calm and specific. The customer needs clarity, not excuses.'
      : roleType === 'parts'
        ? 'Be crisp and confident. Clear answers win the counter.'
        : 'Coach the next step with clarity and confidence.',
    customerConcern: roleType === 'service'
      ? 'repair update'
      : roleType === 'parts'
        ? 'part availability'
        : 'coach support',
    scenarioSummary: roleType === 'service'
      ? 'A service customer is challenging the wait time and needs a clear, calm update.'
      : roleType === 'parts'
        ? 'A parts customer needs quick, clear answers on fitment, pricing, and timing.'
        : 'A consultant needs support through a live customer challenge.',
  };
  const details = experienceByRole[normalized] || fallback;
  const bossLabel = `${systemLabel} Boss`;
  return {
    systemLabel,
    bossLabel,
    audience: details.audience,
    customerName: details.customerName,
    customerOpening: details.customerOpening,
    coachLine: details.coachLine,
    customerConcern: details.customerConcern,
    scenarioSummary: details.scenarioSummary,
    readyCopy: `The ${systemLabel} boss is ready. Challenge it now.`,
    lockedCopy: `Complete 3 core sessions to unlock the ${systemLabel.toLowerCase()} boss.`,
  };
}

function makeMockIsoDate(daysAgo, hours = 10, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

const MOCK_ROLE_PRESETS = {
  'Sales Consultant': {
    name: 'Maya Brooks',
    role: 'Sales Consultant',
    xp: 7420,
    freshUpMeter: 68,
    stats: {
      empathy: 89,
      listening: 64,
      trust: 72,
      followUp: 39,
      closing: 54,
      relationship: 81,
    },
  },
  BDC: {
    name: 'Noah Price',
    role: 'BDC',
    xp: 5210,
    freshUpMeter: 42,
    stats: {
      empathy: 61,
      listening: 77,
      trust: 55,
      followUp: 87,
      closing: 34,
      relationship: 58,
    },
  },
  'Service Writer': {
    name: 'Ari Lane',
    role: 'Service Writer',
    xp: 8940,
    freshUpMeter: 74,
    stats: {
      empathy: 57,
      listening: 88,
      trust: 69,
      followUp: 45,
      closing: 31,
      relationship: 73,
    },
  },
  'Parts Consultant': {
    name: 'Zoe Patel',
    role: 'Parts Consultant',
    xp: 4680,
    freshUpMeter: 36,
    stats: {
      empathy: 44,
      listening: 56,
      trust: 39,
      followUp: 82,
      closing: 28,
      relationship: 34,
    },
  },
  'Finance Manager': {
    name: 'Liam Chen',
    role: 'Finance Manager',
    xp: 13240,
    freshUpMeter: 59,
    stats: {
      empathy: 63,
      listening: 51,
      trust: 75,
      followUp: 59,
      closing: 86,
      relationship: 48,
    },
  },
  'Sales Manager': {
    name: 'Dakota Reed',
    role: 'manager',
    xp: 16420,
    freshUpMeter: 73,
    stats: {
      empathy: 92,
      listening: 38,
      trust: 86,
      followUp: 27,
      closing: 79,
      relationship: 48,
    },
  },
  'Service Manager': {
    name: 'Eva Martinez',
    role: 'Service Manager',
    xp: 17880,
    freshUpMeter: 66,
    stats: {
      empathy: 68,
      listening: 91,
      trust: 70,
      followUp: 53,
      closing: 61,
      relationship: 62,
    },
  },
  'Parts Manager': {
    name: 'Owen Reed',
    role: 'Parts Manager',
    xp: 14950,
    freshUpMeter: 52,
    stats: {
      empathy: 49,
      listening: 52,
      trust: 47,
      followUp: 76,
      closing: 58,
      relationship: 41,
    },
  },
  'General Manager': {
    name: 'Morgan Ellis',
    role: 'General Manager',
    xp: 21600,
    freshUpMeter: 79,
    stats: {
      empathy: 76,
      listening: 63,
      trust: 80,
      followUp: 55,
      closing: 69,
      relationship: 71,
    },
  },
  Owner: {
    name: 'Sam Carter',
    role: 'Owner',
    xp: 28400,
    freshUpMeter: 86,
    stats: {
      empathy: 81,
      listening: 58,
      trust: 85,
      followUp: 62,
      closing: 73,
      relationship: 77,
    },
  },
  Trainer: {
    name: 'Jamie Fox',
    role: 'Trainer',
    xp: 9300,
    freshUpMeter: 61,
    stats: {
      empathy: 88,
      listening: 86,
      trust: 79,
      followUp: 45,
      closing: 60,
      relationship: 82,
    },
  },
};

function getMockRolePreset(roleLabel) {
  const normalized = normalizeRoleLabel(roleLabel);
  return MOCK_ROLE_PRESETS[normalized] || {
    name: 'Taylor Morgan',
    role: normalized || 'Sales Consultant',
    xp: 6400,
    freshUpMeter: 55,
    stats: {
      empathy: 74,
      listening: 66,
      trust: 61,
      followUp: 52,
      closing: 47,
      relationship: 68,
    },
  };
}

function buildMockRecentSessions(roleLabel, roleType) {
  const role = normalizeRoleLabel(roleLabel);
  const base = roleType === 'service'
    ? [
        { title: 'Write-Up Friction', duration: 11, score: 33, offset: 0 },
        { title: 'MPI Explanation', duration: 17, score: 84, offset: 1 },
        { title: 'Pickup Confidence', duration: 9, score: 61, offset: 2 },
      ]
    : roleType === 'parts'
      ? [
          { title: 'Counter Request', duration: 8, score: 44, offset: 0 },
          { title: 'Backorder Recovery', duration: 13, score: 88, offset: 1 },
          { title: 'Fitment Check', duration: 7, score: 52, offset: 2 },
        ]
      : roleType === 'fi'
        ? [
            { title: 'Menu Presentation', duration: 14, score: 79, offset: 0 },
            { title: 'Objection Spike', duration: 10, score: 42, offset: 1 },
            { title: 'Signed Delivery', duration: 18, score: 91, offset: 2 },
          ]
        : [
            { title: 'Late Morning Up-Track', duration: 14, score: 91, offset: 0 },
            { title: 'Rough Trade Conversation', duration: 8, score: 41, offset: 1 },
            { title: 'Delivery Confidence Check', duration: 21, score: 78, offset: 2 },
          ];
  return base.map((item) => ({
    title: `${role} · ${item.title}`,
    timestamp: makeMockIsoDate(item.offset, 10 + item.offset, 10 + item.offset),
    duration: item.duration,
    score: item.score,
  }));
}

function buildMockMomentumSeries(roleLabel, roleType, focusTrait) {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const normalizedRole = normalizeRoleLabel(roleLabel);
  const roleKey = String(roleType || '').toLowerCase();
  const patterns = {
    'Sales Consultant': [8, 94, 15, 86, 22, 100],
    BDC: [24, 87, 18, 91, 29, 96],
    'Service Writer': [88, 14, 91, 24, 77, 48],
    'Parts Consultant': [73, 11, 68, 19, 95, 27],
    'Finance Manager': [19, 83, 14, 71, 35, 96],
    'Sales Manager': [62, 17, 84, 13, 93, 55],
    'Service Manager': [86, 21, 90, 25, 73, 50],
    'Parts Manager': [74, 16, 63, 20, 89, 31],
    'General Manager': [57, 24, 82, 18, 95, 68],
    Owner: [68, 31, 88, 22, 98, 77],
    Trainer: [79, 44, 92, 37, 99, 71],
    sales: [8, 94, 15, 86, 22, 100],
    service: [88, 14, 91, 24, 77, 48],
    parts: [73, 11, 68, 19, 95, 27],
    fi: [18, 89, 12, 78, 31, 97],
    manager: [62, 17, 84, 13, 93, 55],
    leadership: [79, 29, 92, 21, 98, 67],
    default: [42, 58, 27, 69, 47, 81],
  };
  const basePattern = patterns[normalizedRole] || patterns[roleKey] || patterns.default;
  const focusIndex = ['empathy', 'listening', 'trust', 'followUp', 'closing', 'relationship']
    .indexOf(String(focusTrait || '').toLowerCase());
  const nameSkew = normalizedRole.length % 5;

  return labels.map((label, index) => {
    const focusBoost = focusIndex === index ? 6 : focusIndex === (index + 1) % labels.length ? 3 : 0;
    const swing = index % 2 === 0 ? -4 + nameSkew : 5 - nameSkew;
    const lateRun = index >= 4 ? 7 + nameSkew : 0;
    const value = clampScore(basePattern[index] + swing + lateRun + focusBoost);
    return { label, value };
  });
}

function offsetMockMomentumSeries(series, deltas) {
  if (!Array.isArray(series) || series.length === 0) return [];
  return series.map((item, index) => ({
    label: item.label,
    value: clampScore(Number(item.value || 0) + Number(deltas?.[index] || 0)),
  }));
}

function buildMockManagerStoreSummary({
  dealershipId,
  dealershipName,
  roleProfile,
  focusTrait,
  storePerformance,
  trendLabel,
  departmentAverageScores,
  departmentMomentum,
  momentumSeries,
  teamMonitor,
  teamMembers,
  biggestOpportunity,
  todayFocus,
  scopeLabel,
}) {
  return {
    dealershipId,
    dealershipName,
    scopeLabel: scopeLabel || dealershipName,
    storePerformance,
    trendLabel,
    biggestOpportunity,
    todayFocus,
    autoForgeFocus: `This week's focus: ${TRAIT_LABELS[focusTrait] || focusTrait} across team`,
    departmentAverageScores,
    departmentMomentum,
    momentumSeries,
    teamMonitor,
    teamMembers,
    candidateCount: Array.isArray(teamMembers) ? teamMembers.length : 0,
    activeUsers: Array.isArray(teamMembers)
      ? teamMembers.filter((member) => {
        const label = String(member.lastActive || '').toLowerCase();
        return label === 'just now' || label.endsWith('m ago') || label.endsWith('h ago');
      }).length
      : 0,
    strongestTrait: departmentAverageScores
      ? strongestTrait(buildAverageStatsLike(departmentAverageScores))
      : focusTrait,
    focusTrait,
    roleProfile,
  };
}

function buildMockManagerDashboard({ roleProfile, focusTrait, recentLogs, userData }) {
  if (['Owner', 'General Manager'].includes(roleProfile.roleLabel)) {
    const sharedTodayFocus = buildManagerTodayFocus(roleProfile, focusTrait, `${MOCK_USER_ID}:today-focus`);
    const storeOne = buildMockManagerStoreSummary({
      dealershipId: 'mock-store-1',
      dealershipName: 'Northline Toyota',
      roleProfile,
      focusTrait: 'closing',
      storePerformance: 79,
      trendLabel: '+6% Trend',
      departmentAverageScores: {
        empathy: 88,
        listening: 64,
        trust: 81,
        followUp: 58,
        closing: 62,
        relationship: 74,
      },
      departmentMomentum: 71,
      momentumSeries: offsetMockMomentumSeries(buildMockMomentumSeries('Owner', 'leadership', 'closing'), [4, -6, 8, -5, 11, -3]),
      teamMonitor: [
        {
          id: 'mock-owner-store-1-team-1',
          name: 'Nadia Brooks',
          role: 'Sales Consultant',
          level: 14,
          topSkill: 'Empathy',
          watchArea: 'Closing',
          lastActive: '18m ago',
        },
        {
          id: 'mock-owner-store-1-team-2',
          name: 'Eli Mercer',
          role: 'Service Writer',
          level: 11,
          topSkill: 'Trust',
          watchArea: 'Pacing',
          lastActive: '2h ago',
        },
      ],
      teamMembers: [
        {
          id: 'mock-owner-store-1-team-1',
          userId: 'mock-owner-store-1-team-1',
          name: 'Nadia Brooks',
          role: 'Sales Consultant',
          roleLabel: 'Sales Consultant',
          roleType: 'sales',
          avatarUrl: '',
          xp: 6840,
          level: calculateLevel(6840),
          streak: 8,
          momentumScore: 61,
          focusTrait: 'closing',
          strongTrait: 'empathy',
          freshUpMeter: 48,
          freshUpAvailable: true,
          momentumSeries: buildMockMomentumSeries('Sales Consultant', 'sales', 'closing'),
          stats: normalizeStats({
            empathy: { score: 91, lastUpdated: makeMockIsoDate(0, 10, 0) },
            listening: { score: 66, lastUpdated: makeMockIsoDate(1, 14, 20) },
            trust: { score: 74, lastUpdated: makeMockIsoDate(0, 11, 5) },
            followUp: { score: 53, lastUpdated: makeMockIsoDate(2, 9, 0) },
            closing: { score: 49, lastUpdated: makeMockIsoDate(1, 15, 45) },
            relationship: { score: 72, lastUpdated: makeMockIsoDate(3, 8, 30) },
          }),
          recentSessions: [
            { title: 'High-Stress Resolution', timestamp: makeMockIsoDate(0, 14, 45), duration: 14, score: 82 },
            { title: 'Product Inquiry', timestamp: makeMockIsoDate(1, 11, 15), duration: 8, score: 61 },
            { title: 'Closing Demo', timestamp: makeMockIsoDate(3, 13, 0), duration: 45, score: 94 },
          ],
          topSkill: 'Empathy',
          watchArea: 'Closing',
          lastActive: '18m ago',
        },
        {
          id: 'mock-owner-store-1-team-2',
          userId: 'mock-owner-store-1-team-2',
          name: 'Eli Mercer',
          role: 'Service Writer',
          roleLabel: 'Service Writer',
          roleType: 'service',
          avatarUrl: '',
          xp: 5420,
          level: calculateLevel(5420),
          streak: 6,
          momentumScore: 44,
          focusTrait: 'pacing',
          strongTrait: 'trust',
          freshUpMeter: 37,
          freshUpAvailable: false,
          momentumSeries: buildMockMomentumSeries('Service Writer', 'service', 'pacing'),
          stats: normalizeStats({
            empathy: { score: 58, lastUpdated: makeMockIsoDate(0, 9, 40) },
            listening: { score: 87, lastUpdated: makeMockIsoDate(1, 13, 0) },
            trust: { score: 81, lastUpdated: makeMockIsoDate(0, 12, 10) },
            followUp: { score: 46, lastUpdated: makeMockIsoDate(2, 10, 30) },
            closing: { score: 33, lastUpdated: makeMockIsoDate(1, 16, 5) },
            relationship: { score: 69, lastUpdated: makeMockIsoDate(3, 8, 50) },
          }),
          recentSessions: [
            { title: 'High-Stress Resolution', timestamp: makeMockIsoDate(0, 15, 20), duration: 12, score: 76 },
            { title: 'Product Inquiry', timestamp: makeMockIsoDate(2, 10, 5), duration: 10, score: 58 },
            { title: 'Closing Demo', timestamp: makeMockIsoDate(4, 13, 40), duration: 31, score: 71 },
          ],
          topSkill: 'Trust',
          watchArea: 'Pacing',
          lastActive: '2h ago',
        },
      ],
      biggestOpportunity: {
        title: 'Closing and follow-up are all over the map this week.',
        body: 'Use a tighter coaching plan to steady the team before the next cycle.',
      },
      todayFocus: sharedTodayFocus,
    });

    const storeTwo = buildMockManagerStoreSummary({
      dealershipId: 'mock-store-2',
      dealershipName: 'Valley Ford',
      roleProfile,
      focusTrait: 'trust',
      storePerformance: 63,
      trendLabel: '-3% Trend',
      departmentAverageScores: {
        empathy: 73,
        listening: 59,
        trust: 66,
        followUp: 41,
        closing: 57,
        relationship: 62,
      },
      departmentMomentum: 60,
      momentumSeries: offsetMockMomentumSeries(buildMockMomentumSeries('Owner', 'leadership', 'trust'), [-7, 4, -2, 8, -6, 12]),
      teamMonitor: [
        {
          id: 'mock-owner-store-2-team-1',
          name: 'Maya Chen',
          role: 'Sales Consultant',
          level: 12,
          topSkill: 'Trust',
          watchArea: 'Follow-Up',
          lastActive: '42m ago',
        },
        {
          id: 'mock-owner-store-2-team-2',
          name: 'Jose Ramirez',
          role: 'BDC',
          level: 9,
          topSkill: 'Listening',
          watchArea: 'Closing',
          lastActive: '4h ago',
        },
      ],
      teamMembers: [
        {
          id: 'mock-owner-store-2-team-1',
          userId: 'mock-owner-store-2-team-1',
          name: 'Maya Chen',
          role: 'Sales Consultant',
          roleLabel: 'Sales Consultant',
          roleType: 'sales',
          avatarUrl: '',
          xp: 6120,
          level: calculateLevel(6120),
          streak: 5,
          momentumScore: 58,
          focusTrait: 'trust',
          strongTrait: 'listening',
          freshUpMeter: 41,
          freshUpAvailable: true,
          momentumSeries: buildMockMomentumSeries('Sales Consultant', 'sales', 'trust'),
          stats: normalizeStats({
            empathy: { score: 76, lastUpdated: makeMockIsoDate(0, 8, 20) },
            listening: { score: 68, lastUpdated: makeMockIsoDate(1, 10, 10) },
            trust: { score: 61, lastUpdated: makeMockIsoDate(0, 9, 5) },
            followUp: { score: 44, lastUpdated: makeMockIsoDate(2, 7, 0) },
            closing: { score: 53, lastUpdated: makeMockIsoDate(1, 11, 15) },
            relationship: { score: 66, lastUpdated: makeMockIsoDate(3, 6, 30) },
          }),
          recentSessions: [
            { title: 'Trade Walkthrough', timestamp: makeMockIsoDate(0, 16, 10), duration: 17, score: 68 },
            { title: 'Objection Recovery', timestamp: makeMockIsoDate(1, 13, 45), duration: 11, score: 57 },
          ],
          topSkill: 'Listening',
          watchArea: 'Follow-Up',
          lastActive: '42m ago',
        },
        {
          id: 'mock-owner-store-2-team-2',
          userId: 'mock-owner-store-2-team-2',
          name: 'Jose Ramirez',
          role: 'BDC',
          roleLabel: 'BDC',
          roleType: 'sales',
          avatarUrl: '',
          xp: 4780,
          level: calculateLevel(4780),
          streak: 4,
          momentumScore: 51,
          focusTrait: 'closing',
          strongTrait: 'listening',
          freshUpMeter: 33,
          freshUpAvailable: false,
          momentumSeries: buildMockMomentumSeries('BDC', 'sales', 'closing'),
          stats: normalizeStats({
            empathy: { score: 63, lastUpdated: makeMockIsoDate(0, 7, 5) },
            listening: { score: 83, lastUpdated: makeMockIsoDate(1, 9, 20) },
            trust: { score: 58, lastUpdated: makeMockIsoDate(0, 8, 10) },
            followUp: { score: 47, lastUpdated: makeMockIsoDate(2, 6, 40) },
            closing: { score: 46, lastUpdated: makeMockIsoDate(1, 10, 25) },
            relationship: { score: 54, lastUpdated: makeMockIsoDate(3, 7, 15) },
          }),
          recentSessions: [
            { title: 'Inbound Lead', timestamp: makeMockIsoDate(0, 17, 5), duration: 6, score: 73 },
            { title: 'Lost Lead Recovery', timestamp: makeMockIsoDate(2, 12, 20), duration: 9, score: 49 },
          ],
          topSkill: 'Listening',
          watchArea: 'Closing',
          lastActive: '4h ago',
        },
      ],
      biggestOpportunity: {
        title: 'Trust is solid, but follow-up is slipping at the edges.',
        body: 'A steadier follow-up cadence will keep this store from leaking opportunities.',
      },
      todayFocus: buildManagerTodayFocus(roleProfile, 'trust', `${MOCK_USER_ID}:store-2-focus`),
    });

    const storeThree = buildMockManagerStoreSummary({
      dealershipId: 'mock-store-3',
      dealershipName: 'Summit Service Center',
      roleProfile,
      focusTrait: 'followUp',
      storePerformance: 84,
      trendLabel: '+8% Trend',
      departmentAverageScores: {
        empathy: 69,
        listening: 84,
        trust: 88,
        followUp: 77,
        closing: 71,
        relationship: 82,
      },
      departmentMomentum: 79,
      momentumSeries: offsetMockMomentumSeries(buildMockMomentumSeries('Owner', 'leadership', 'followUp'), [8, -2, 9, -4, 10, 6]),
      teamMonitor: [
        {
          id: 'mock-owner-store-3-team-1',
          name: 'Priya Shah',
          role: 'Service Manager',
          level: 15,
          topSkill: 'Trust',
          watchArea: 'Closing',
          lastActive: '12m ago',
        },
        {
          id: 'mock-owner-store-3-team-2',
          name: 'Theo Grant',
          role: 'Service Writer',
          level: 13,
          topSkill: 'Listening',
          watchArea: 'Pacing',
          lastActive: '1h ago',
        },
      ],
      teamMembers: [
        {
          id: 'mock-owner-store-3-team-1',
          userId: 'mock-owner-store-3-team-1',
          name: 'Priya Shah',
          role: 'Service Manager',
          roleLabel: 'Service Manager',
          roleType: 'service',
          avatarUrl: '',
          xp: 7420,
          level: calculateLevel(7420),
          streak: 10,
          momentumScore: 77,
          focusTrait: 'closing',
          strongTrait: 'trust',
          freshUpMeter: 66,
          freshUpAvailable: true,
          momentumSeries: buildMockMomentumSeries('Service Manager', 'service', 'closing'),
          stats: normalizeStats({
            empathy: { score: 72, lastUpdated: makeMockIsoDate(0, 9, 20) },
            listening: { score: 88, lastUpdated: makeMockIsoDate(1, 12, 35) },
            trust: { score: 86, lastUpdated: makeMockIsoDate(0, 10, 15) },
            followUp: { score: 74, lastUpdated: makeMockIsoDate(2, 9, 45) },
            closing: { score: 68, lastUpdated: makeMockIsoDate(1, 15, 10) },
            relationship: { score: 79, lastUpdated: makeMockIsoDate(3, 7, 55) },
          }),
          recentSessions: [
            { title: 'Service Handoff', timestamp: makeMockIsoDate(0, 14, 15), duration: 16, score: 88 },
            { title: 'Rush Repair', timestamp: makeMockIsoDate(1, 11, 30), duration: 13, score: 77 },
          ],
          topSkill: 'Trust',
          watchArea: 'Closing',
          lastActive: '12m ago',
        },
        {
          id: 'mock-owner-store-3-team-2',
          userId: 'mock-owner-store-3-team-2',
          name: 'Theo Grant',
          role: 'Service Writer',
          roleLabel: 'Service Writer',
          roleType: 'service',
          avatarUrl: '',
          xp: 6310,
          level: calculateLevel(6310),
          streak: 7,
          momentumScore: 68,
          focusTrait: 'pacing',
          strongTrait: 'listening',
          freshUpMeter: 55,
          freshUpAvailable: true,
          momentumSeries: buildMockMomentumSeries('Service Writer', 'service', 'pacing'),
          stats: normalizeStats({
            empathy: { score: 66, lastUpdated: makeMockIsoDate(0, 8, 55) },
            listening: { score: 81, lastUpdated: makeMockIsoDate(1, 11, 25) },
            trust: { score: 75, lastUpdated: makeMockIsoDate(0, 9, 40) },
            followUp: { score: 72, lastUpdated: makeMockIsoDate(2, 8, 15) },
            closing: { score: 60, lastUpdated: makeMockIsoDate(1, 14, 30) },
            relationship: { score: 76, lastUpdated: makeMockIsoDate(3, 7, 20) },
          }),
          recentSessions: [
            { title: 'MPI Review', timestamp: makeMockIsoDate(0, 13, 10), duration: 11, score: 84 },
            { title: 'Pickup Delay', timestamp: makeMockIsoDate(2, 9, 5), duration: 9, score: 65 },
          ],
          topSkill: 'Listening',
          watchArea: 'Pacing',
          lastActive: '1h ago',
        },
      ],
      biggestOpportunity: {
        title: 'Follow-up and closing are the only things holding the floor back.',
        body: 'The lane is healthy. Keep the team moving with tighter end-of-visit follow-up.',
      },
      todayFocus: buildManagerTodayFocus(roleProfile, 'followUp', `${MOCK_USER_ID}:store-3-focus`),
    });

    const storeSummaries = [storeOne, storeTwo, storeThree];
    const aggregateAverageScores = {
      empathy: Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.departmentAverageScores?.empathy || 0), 0) / storeSummaries.length),
      listening: Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.departmentAverageScores?.listening || 0), 0) / storeSummaries.length),
      trust: Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.departmentAverageScores?.trust || 0), 0) / storeSummaries.length),
      followUp: Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.departmentAverageScores?.followUp || 0), 0) / storeSummaries.length),
      closing: Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.departmentAverageScores?.closing || 0), 0) / storeSummaries.length),
      relationship: Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.departmentAverageScores?.relationship || 0), 0) / storeSummaries.length),
    };
    const aggregateMomentum = Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.departmentMomentum || 0), 0) / storeSummaries.length);
    const aggregatePerformance = Math.round(storeSummaries.reduce((sum, store) => sum + Number(store.storePerformance || 0), 0) / storeSummaries.length);
    const aggregateTeamMonitor = [
      storeSummaries[0].teamMonitor?.[0],
      storeSummaries[1].teamMonitor?.[0],
      storeSummaries[2].teamMonitor?.[0],
    ].filter(Boolean).slice(0, 2);
    const aggregateTeamMembers = storeSummaries.flatMap((store) => store.teamMembers || []).slice(0, 2);

    return {
      storePerformance: aggregatePerformance,
      trendLabel: '+4% Trend',
      biggestOpportunity: {
        title: 'Store performance is uneven across the network.',
        body: 'Keep the coaching plan simple so each store gets the next right focus without clutter.',
      },
      todayFocus: sharedTodayFocus,
      autoForgeFocus: `This week's focus: ${TRAIT_LABELS[focusTrait] || focusTrait} across team`,
      departmentAverageScores: aggregateAverageScores,
      departmentMomentum: aggregateMomentum,
      momentumSeries: offsetMockMomentumSeries(buildMockMomentumSeries(roleProfile.roleLabel, roleProfile.roleType, focusTrait), [6, -4, 9, -2, 11, 5]),
      teamMonitor: aggregateTeamMonitor,
      teamMembers: aggregateTeamMembers,
      stores: storeSummaries,
      mode: 'multi-store',
      scopeLabel: 'All stores',
    };
  }

  const departmentAverageScores = {
    empathy: 92,
    listening: 38,
    trust: 85,
    followUp: 26,
    closing: 77,
    relationship: 49,
  };
  const storePerformance = 66;
  const departmentMomentum = 58;
  const momentumSeries = buildMockMomentumSeries(roleProfile.roleLabel, roleProfile.roleType, focusTrait);
  const todayFocus = buildManagerTodayFocus(roleProfile, focusTrait, `${MOCK_USER_ID}:today-focus`);
  const teamMonitor = [
    {
      id: 'mock-team-1',
      name: 'Nadia Brooks',
      role: 'Sales Consultant',
      level: 14,
      topSkill: 'Empathy',
      watchArea: 'Closing',
      lastActive: '18m ago',
    },
    {
      id: 'mock-team-2',
      name: 'Eli Mercer',
      role: 'Service Writer',
      level: 11,
      topSkill: 'Trust',
      watchArea: 'Pacing',
      lastActive: '2h ago',
    },
  ];
  const teamMembers = [
    {
      id: 'mock-team-1',
      userId: 'mock-team-1',
      name: 'Nadia Brooks',
      role: 'Sales Consultant',
      roleLabel: 'Sales Consultant',
      roleType: 'sales',
      avatarUrl: '',
      xp: 6840,
      level: calculateLevel(6840),
      streak: 8,
      momentumScore: 61,
      focusTrait: 'closing',
      strongTrait: 'empathy',
      freshUpMeter: 48,
      freshUpAvailable: true,
      momentumSeries: buildMockMomentumSeries('Sales Consultant', 'sales', 'closing'),
      stats: normalizeStats({
        empathy: { score: 91, lastUpdated: makeMockIsoDate(0, 10, 0) },
        listening: { score: 66, lastUpdated: makeMockIsoDate(1, 14, 20) },
        trust: { score: 74, lastUpdated: makeMockIsoDate(0, 11, 5) },
        followUp: { score: 53, lastUpdated: makeMockIsoDate(2, 9, 0) },
        closing: { score: 49, lastUpdated: makeMockIsoDate(1, 15, 45) },
        relationship: { score: 72, lastUpdated: makeMockIsoDate(3, 8, 30) },
      }),
      recentSessions: [
        { title: 'High-Stress Resolution', timestamp: makeMockIsoDate(0, 14, 45), duration: 14, score: 82 },
        { title: 'Product Inquiry', timestamp: makeMockIsoDate(1, 11, 15), duration: 8, score: 61 },
        { title: 'Closing Demo', timestamp: makeMockIsoDate(3, 13, 0), duration: 45, score: 94 },
      ],
      topSkill: 'Empathy',
      watchArea: 'Closing',
      lastActive: '18m ago',
    },
    {
      id: 'mock-team-2',
      userId: 'mock-team-2',
      name: 'Eli Mercer',
      role: 'Service Writer',
      roleLabel: 'Service Writer',
      roleType: 'service',
      avatarUrl: '',
      xp: 5420,
      level: calculateLevel(5420),
      streak: 6,
      momentumScore: 44,
      focusTrait: 'pacing',
      strongTrait: 'trust',
      freshUpMeter: 37,
      freshUpAvailable: false,
      momentumSeries: buildMockMomentumSeries('Service Writer', 'service', 'pacing'),
      stats: normalizeStats({
        empathy: { score: 58, lastUpdated: makeMockIsoDate(0, 9, 40) },
        listening: { score: 87, lastUpdated: makeMockIsoDate(1, 13, 0) },
        trust: { score: 81, lastUpdated: makeMockIsoDate(0, 12, 10) },
        followUp: { score: 46, lastUpdated: makeMockIsoDate(2, 10, 30) },
        closing: { score: 33, lastUpdated: makeMockIsoDate(1, 16, 5) },
        relationship: { score: 69, lastUpdated: makeMockIsoDate(3, 8, 50) },
      }),
      recentSessions: [
        { title: 'High-Stress Resolution', timestamp: makeMockIsoDate(0, 15, 20), duration: 12, score: 76 },
        { title: 'Product Inquiry', timestamp: makeMockIsoDate(2, 10, 5), duration: 10, score: 58 },
        { title: 'Closing Demo', timestamp: makeMockIsoDate(4, 13, 40), duration: 31, score: 71 },
      ],
      topSkill: 'Trust',
      watchArea: 'Pacing',
      lastActive: '2h ago',
    },
  ];

  return {
    storePerformance,
    trendLabel: '-6% Trend',
    biggestOpportunity: {
      title: 'Closing and follow-up are all over the map this week.',
      body: 'Use a tighter coaching plan to steady the team before the next cycle.',
    },
    todayFocus,
    autoForgeFocus: `This week's focus: ${TRAIT_LABELS[focusTrait] || focusTrait} across team`,
    departmentAverageScores,
    departmentMomentum,
    momentumSeries,
    teamMonitor,
    teamMembers,
  };
}

function buildMockUserBundle(roleOverride = null) {
  const roleLabel = normalizeRoleLabel(roleOverride || 'Sales Manager');
  const roleProfile = getRoleProfile(roleLabel);
  const preset = getMockRolePreset(roleProfile.roleLabel);
  const stats = normalizeStats({
    empathy: { score: preset.stats.empathy, lastUpdated: makeMockIsoDate(0, 9, 30) },
    listening: { score: preset.stats.listening, lastUpdated: makeMockIsoDate(1, 14, 10) },
    trust: { score: preset.stats.trust, lastUpdated: makeMockIsoDate(0, 12, 5) },
    followUp: { score: preset.stats.followUp, lastUpdated: makeMockIsoDate(2, 10, 20) },
    closing: { score: preset.stats.closing, lastUpdated: makeMockIsoDate(1, 16, 45) },
    relationship: { score: preset.stats.relationship, lastUpdated: makeMockIsoDate(3, 8, 15) },
  });
  const recentSessions = buildMockRecentSessions(roleProfile.roleLabel, roleProfile.roleType);
  const recentTimestamps = recentSessions.map((session) => session.timestamp);
  const userData = {
    name: preset.name,
    role: preset.role,
    avatarUrl: '',
    xp: preset.xp,
    dealershipId: 'mock-dealership',
    dealershipIds: ['mock-dealership'],
    selfDeclaredDealershipId: 'mock-dealership',
    dealershipName: 'Mock Dealership',
    stats,
    freshUpMeter: preset.freshUpMeter,
    freshUpAvailable: true,
    freshUpCompletedCount: 6,
    freshUpCoreSessionsSinceLast: 3,
    freshUpLastTriggeredAt: makeMockIsoDate(1, 18, 0),
    freshUpLastCompletedAt: makeMockIsoDate(2, 11, 30),
    visibilityScope: getVisibilityScopeForRole(roleProfile.roleLabel),
  };
  const focusTrait = weakestTrait(stats);
  const strongTrait = strongestTrait(stats);
  const averageSkill = scoreFromStats(stats);
  const level = calculateLevel(userData.xp);
  const streak = calculateStreak(recentTimestamps);
  const momentumScore = Math.max(0, Math.min(100, Math.round(Math.max(averageSkill, userData.freshUpMeter / 1.25))));
  const momentumSeries = buildMockMomentumSeries(roleProfile.roleLabel, roleProfile.roleType, focusTrait);
  const lessonCategory = pickRoleLessonCategory(roleProfile.roleLabel, roleProfile.roleType, focusTrait, `${MOCK_USER_ID}:${dateKey(new Date())}`);
  const lessonProfile = getLessonCategoryProfile(lessonCategory);
  const lessonLibrary = buildLessonLibrary(roleProfile.roleLabel, roleProfile.roleType, focusTrait, lessonCategory);
  const focus = buildMissionFocus(focusTrait, roleProfile.roleLabel, lessonCategory);
  const freshUpExperience = getFreshUpExperience(roleProfile.roleLabel, roleProfile.roleType);
  const managerDashboard = isManagerDashboardRole(roleProfile.roleLabel)
    ? buildMockManagerDashboard({
        roleProfile,
        focusTrait,
        recentLogs: recentSessions,
        userData,
      })
    : null;
  const developerDashboard = isPrivilegedDealershipRole(roleProfile.roleLabel)
    ? {
        generatedAt: new Date().toISOString(),
        summary: {
          totalUsers: 2,
          avgXp: Math.round((userData.xp + 8420) / 2),
          avgMomentum: Math.round((momentumScore + 74) / 2),
          activeToday: 2,
          roleCounts: {
            [roleProfile.roleLabel]: 1,
            'Sales Consultant': 1,
          },
        },
        users: [
          {
            id: 'mock-team-1',
            name: 'Nadia Brooks',
            email: 'nadia.brooks@example.com',
            role: 'Sales Consultant',
            roleType: 'sales',
            roleScope: 'manager_and_under',
            visibilityScope: 'Self',
            xp: 6840,
            level: calculateLevel(6840),
            streak: 8,
            momentumScore: 61,
            freshUpMeter: 48,
            freshUpAvailable: true,
            lessonCategory: 'Sales - Closing',
            lastActive: '18m ago',
            lastLesson: 'Closing Demo',
            stats: normalizeStats({
              empathy: { score: 91 },
              listening: { score: 66 },
              trust: { score: 74 },
              followUp: { score: 53 },
              closing: { score: 49 },
              relationship: { score: 72 },
            }),
            recentSession: { title: 'Closing Demo', timestamp: makeMockIsoDate(0, 13, 0), score: 94 },
          },
          {
            id: 'mock-team-2',
            name: 'Eli Mercer',
            email: 'eli.mercer@example.com',
            role: 'Service Writer',
            roleType: 'service',
            roleScope: 'manager_and_under',
            visibilityScope: 'Self',
            xp: 5420,
            level: calculateLevel(5420),
            streak: 6,
            momentumScore: 44,
            freshUpMeter: 37,
            freshUpAvailable: false,
            lessonCategory: 'Service - Write-Up',
            lastActive: '2h ago',
            lastLesson: 'Write-Up Friction',
            stats: normalizeStats({
              empathy: { score: 58 },
              listening: { score: 87 },
              trust: { score: 81 },
              followUp: { score: 46 },
              closing: { score: 33 },
              relationship: { score: 69 },
            }),
            recentSession: { title: 'Write-Up Friction', timestamp: makeMockIsoDate(0, 15, 20), score: 76 },
          },
        ],
        self: {
          currentUserId: MOCK_USER_ID,
          currentRole: roleProfile.roleLabel,
        },
      }
    : null;

  return {
    mockMode: true,
    user: {
      userId: MOCK_USER_ID,
      name: userData.name,
      role: userData.role,
      sourceRole: userData.role,
      roleLabel: roleProfile.roleLabel,
      stats,
      xp: userData.xp,
      level,
      streak,
      momentumScore,
      focusTrait,
      strongTrait,
      freshUpMeter: userData.freshUpMeter,
      freshUpAvailable: userData.freshUpAvailable,
      freshUpCoreSessionsSinceLast: userData.freshUpCoreSessionsSinceLast,
      roleType: roleProfile.roleType,
      roleScope: roleProfile.maxEnrollmentScope,
      lessonCategory,
      momentumSeries,
      roleOverride: roleOverride ? roleProfile.roleLabel : null,
      mockMode: true,
    },
    recentSessions,
    badges: [
      { id: 'mock-badge-1', timestamp: makeMockIsoDate(0, 12, 0) },
      { id: 'mock-badge-2', timestamp: makeMockIsoDate(2, 9, 0) },
    ],
    focus,
    insight: 'You have strong highs already. Keep smoothing the valleys and your average will climb with it.',
    roleProfile,
    freshUpExperience,
    freshUpSystemLabel: freshUpExperience.systemLabel,
    freshUpBossLabel: freshUpExperience.bossLabel,
    lessonCategory,
    lessonProfile,
    lessonLibrary,
    momentumSeries,
    managerDashboard,
    developerDashboard,
  };
}

function inferAutoForgeDepartment(roleLabel) {
  const role = normalizeRoleLabel(roleLabel);
  if (role === 'Service Writer' || role === 'Service Manager') return 'Service';
  if (role === 'Parts Consultant' || role === 'Parts Manager') return 'Parts';
  if (role === 'Finance Manager') return 'F&I';
  if (role === 'Sales Consultant' || role === 'BDC' || role === 'Sales Manager' || role === 'manager') return 'Sales';
  if (role === 'General Manager' || role === 'Owner' || role === 'Trainer' || role === 'Admin' || role === 'Developer') {
    return 'Storewide Leadership';
  }
  return 'Storewide';
}

function inferAutoForgeTheme(trait, summaryText = '') {
  const key = String(trait || '').toLowerCase();
  if (key === 'empathy') return 'Human First';
  if (key === 'listening') return 'Clarity';
  if (key === 'trust') return 'Trust';
  if (key === 'followup') return 'Follow-Through';
  if (key === 'closing') return /resolution/i.test(summaryText) ? 'Resolution' : 'Predictability';
  if (key === 'relationship') return 'Consistency';
  if (/transparency/i.test(summaryText)) return 'Transparency';
  if (/technology/i.test(summaryText)) return 'Technology Comfort';
  if (/friction/i.test(summaryText)) return 'Friction Removal';
  return 'Culture';
}

function selectManagerDashboardStoreView(managerDashboard, storeSelection = 'all') {
  if (!managerDashboard || !Array.isArray(managerDashboard.stores) || managerDashboard.stores.length === 0) {
    return managerDashboard || null;
  }

  const normalizedSelection = String(storeSelection || 'all').trim();
  if (!normalizedSelection || normalizedSelection === 'all') {
    return managerDashboard.aggregate || managerDashboard;
  }

  const match = managerDashboard.stores.find((store) => String(store.dealershipId || '').trim() === normalizedSelection);
  return match || managerDashboard.aggregate || managerDashboard;
}

function buildAutoForgeContextFromBundle(bundle, storeSelection = 'all') {
  const user = bundle?.user || {};
  const roleLabel = normalizeRoleLabel(user.roleLabel || user.role || 'Sales Consultant');
  const roleProfile = bundle?.roleProfile || getRoleProfile(roleLabel);
  const managerDashboard = bundle?.managerDashboard || {};
  const activeDashboard = selectManagerDashboardStoreView(managerDashboard, storeSelection) || managerDashboard;
  const department = inferAutoForgeDepartment(roleLabel);
  const dealershipName = String(user.dealershipName || user.storeName || user.companyName || 'Current dealership');
  const dealershipScopeLabel = String(activeDashboard.scopeLabel || roleProfile.enrollmentScopeLabel || managerDashboard.scopeLabel || 'Current scope');
  const teamMonitor = Array.isArray(activeDashboard.teamMonitor) ? activeDashboard.teamMonitor : Array.isArray(managerDashboard.teamMonitor) ? managerDashboard.teamMonitor : [];
  const memberSignals = teamMonitor.map((member) => {
    const parts = [
      member.name || 'Team member',
      member.role || 'Consultant',
      member.watchArea ? `watching ${member.watchArea}` : '',
      member.topSkill ? `strong at ${member.topSkill}` : '',
    ].filter(Boolean);
    return parts.join(' • ');
  }).filter(Boolean);

  const summaryParts = [
    activeDashboard.biggestOpportunity?.body ? `Primary opportunity: ${activeDashboard.biggestOpportunity.body}` : '',
    activeDashboard.todayFocus?.description ? `Today focus: ${activeDashboard.todayFocus.description}` : '',
    activeDashboard.autoForgeFocus ? activeDashboard.autoForgeFocus : '',
    typeof activeDashboard.storePerformance === 'number' ? `Store performance: ${Math.round(activeDashboard.storePerformance)}%.` : '',
    activeDashboard.trendLabel ? `Trend: ${activeDashboard.trendLabel}.` : '',
    teamMonitor.length
      ? `Team monitor: ${teamMonitor
          .map((member) => `${member.name || 'Team member'} (${member.role || 'Consultant'})${member.watchArea ? `, weak ${member.watchArea}` : ''}${member.topSkill ? `, strong ${member.topSkill}` : ''}`)
          .join('; ')}.`
      : '',
  ].filter(Boolean);

  return {
    department,
    managerRole: roleLabel,
    dealershipName: String(activeDashboard.dealershipName || dealershipName),
    dealershipScopeLabel,
    departmentPerformanceSummary: summaryParts.join(' '),
    memberSignals,
    selectedRolePreference: roleLabel,
    focusTrait: user.focusTrait || 'trust',
    roleProfile,
    managerDashboard: activeDashboard,
  };
}

function extractAutoForgePrimaryTheme(report) {
  const text = String(report || '');
  const match = text.match(/^\*\*Primary Theme:\*\*\s*(.+)$/m);
  return match?.[1]?.trim() || 'Consistency';
}

function buildAutoForgePlanTitle(context) {
  const department = String(context?.department || 'Coaching').trim();
  const theme = String(inferAutoForgeTheme(context?.focusTrait || 'trust', context?.departmentPerformanceSummary || '') || 'Coaching').trim();
  const cleanTheme = theme.replace(/\b(coaching plan)\b/i, '').trim() || 'Coaching';
  if (/^human first$/i.test(cleanTheme)) return `${department} Human First Coaching Plan`;
  return `${cleanTheme} Coaching Plan`;
}

function extractAutoForgePlanTitle(report) {
  const text = String(report || '');
  const match = text.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || '';
}

function buildAutoForgeDataSection(context) {
  const department = context.department || 'Storewide';
  const theme = inferAutoForgeTheme(context.focusTrait || 'trust', context.departmentStateSummary || context.departmentPerformanceSummary || '');
  return [
    '## What the Data Is Saying',
    `The department is showing a mixed picture, with ${theme.toLowerCase()} needing to feel more consistent across the full customer experience.`,
    `The clearest next move is to simplify the message, reduce friction, and make the next step easier for every customer in ${department.toLowerCase()}.`,
  ].join('\n');
}

function replaceAutoForgeDataSection(report, context) {
  const source = String(report || '');
  const sectionMatch = source.match(/(^## What the Data Is Saying\s*\n)([\s\S]*?)(?=\n## |\n# |\s*$)/m);
  const replacement = `${buildAutoForgeDataSection(context)}\n`;
  if (!sectionMatch) {
    return source.replace(/^\s*# AutoForge Weekly CX Forge\s*\n/m, (match) => `${match}\n${replacement}`);
  }

  return source.replace(sectionMatch[0], `${replacement}`);
}

function normalizeAutoForgePlanTitle(report, context) {
  const source = String(report || '');
  const generatedTitle = buildAutoForgePlanTitle(context);
  const currentTitle = extractAutoForgePlanTitle(source);
  if (!currentTitle) {
    return `# ${generatedTitle}\n\n${source.trim()}`;
  }
  if (/auto?forge/i.test(currentTitle)) {
    return source.replace(/^#\s+.+$/m, `# ${generatedTitle}`);
  }
  return source;
}

function buildAutoForgeFallbackReport(context) {
  const department = context.department || 'Storewide';
  const summary = context.departmentPerformanceSummary || 'The team is moving well, but there is still a clear opportunity to coach the next step.';
  const theme = inferAutoForgeTheme(context.focusTrait || 'trust', summary);
  const strongVsWeak = [
    `Weak: Move too fast and skip the reason behind the ask.`,
    `Weak: Give a long explanation before setting the next step.`,
    `Strong: Start with the customer concern, then keep the next step simple.`,
    `Strong: Use one clear coach line the whole team can repeat.`,
  ];

  return [
    `# ${buildAutoForgePlanTitle(context)}`,
    '',
    `**Department:** ${department}`,
    `**Primary Theme:** ${theme}`,
    '',
    ...buildAutoForgeDataSection(context).split('\n'),
    '',
    '## Why This Matters',
    '- Customers feel the difference immediately when the opening is clear and calm.',
    '- Better consistency creates cleaner handoffs, stronger trust, and fewer missed next steps.',
    '',
    '## Manager Kickoff Script',
    `Today we are tightening up ${theme.toLowerCase()} for ${department.toLowerCase()}. Keep your coaching simple. Open with the customer need, show the better language, and then have the team repeat it until it feels natural.`,
    '',
    '## Meeting Plan',
    '1. Warm-up',
    '2. Teaching point',
    '3. Strong vs weak example',
    '4. Practice drill',
    '5. Debrief and close',
    '',
    '## Strong vs Weak Examples',
    ...strongVsWeak.map((line) => `- ${line}`),
    '',
    '## Practice Drill',
    '- Setup: Pick one live customer moment from today or yesterday.',
    '- What to do: Read the weak version, then rewrite it as the strong version in one sentence.',
    '- What the manager should listen for: Clear ownership, simple language, and a direct next step.',
    '',
    '## Debrief Questions',
    '- What did we do too fast?',
    '- What language built trust fastest?',
    '- What is the cleanest next step?',
    '',
    '## Week-Long Challenge',
    '- One clear behavior target: Keep the opening and next step consistent.',
    '- How to track it simply: Mark every live coaching moment with a quick check.',
    '- What success looks like by the end of the week: The team can repeat the same language without prompting.',
    '',
    '## Manager Watch-Outs',
    '- Coaching too many things at once.',
    '- Letting the team hide behind jargon.',
    '- Moving on before the next step is clear.',
    '',
    '## Win Condition',
    '- The team can state the goal in one sentence.',
    '- The weak version starts to disappear from daily conversations.',
    '- Customers leave with fewer unanswered questions.',
    '',
    '## Leadership Reflection',
    '- What one line do I want the team to repeat this week?',
    '- Where do I need to slow down my own coaching?',
  ].join('\n');
}

function buildAutoForgePrompt(context) {
  return [
    'You are AutoForge, a dealership CX meeting generator for managers.',
    '',
    "Your job is to read one department's performance data, identify the most urgent customer experience behavior gap, and create a manager-ready \"meeting in a box\" that can be run this week.",
    '',
    'You are not a generic trainer.',
    'You are a focused manager activation engine.',
    '',
    'PRIMARY JOB',
    '- Analyze the department data',
    '- Find the most important CX weakness',
    '- Choose one primary theme',
    '- Create one simple, useful manager-led lesson',
    '- Include a short week-long reinforcement challenge',
    '- Keep the output clean, practical, and easy to teach',
    '',
    'GLOBAL RULES',
    '- Diagnose first, teach second',
    '- Focus on one main issue',
    '- Use plain English',
    '- Write for a busy manager',
    '- Keep it practical, not technical',
    '- Tie the lesson directly to the provided data',
    '- Default meeting length is 10 to 20 minutes',
    '- Output must be easy to scan and render cleanly',
    '- No em dashes',
    '- No fluff, no jargon, no corporate filler',
    '',
    'APPROVED THEMES',
    'Choose the single best theme:',
    '- Trust',
    '- Human First',
    '- Clarity',
    '- Predictability',
    '- Transfer of Confidence',
    '- Emotional Check-In',
    '- Friction Removal',
    '- Resolution',
    '- Delivery Wonder',
    '- Follow-Through',
    '- Employee Experience',
    '- Consistency',
    '- Technology Comfort',
    '- Transparency',
    '- Culture',
    '',
    'THEME LOGIC',
    'Choose the theme that best matches the data:',
    '- Trust: skepticism, pressure, weak credibility, uncertainty',
    '- Human First: cold tone, rushed interaction, weak empathy',
    '- Clarity: confusion, repeated questions, jargon, info-dumping',
    '- Predictability: unclear next steps, weak timelines, surprise delays',
    '- Transfer of Confidence: hesitant delivery, weak certainty, shaky explanations',
    '- Emotional Check-In: customer quietness, hesitation, emotional flatness not addressed',
    '- Friction Removal: clunky process, repeated steps, preventable pain points',
    '- Resolution: weak ownership, complaint mishandling, no follow-through',
    '- Delivery Wonder: weak or forgettable delivery experience',
    '- Follow-Through: poor follow-up, weak retention communication',
    '- Employee Experience: internal stress or confusion leaking into CX',
    '- Consistency: uneven standards, mismatched messaging, poor handoffs',
    '- Technology Comfort: customer or staff discomfort with tech or digital tools',
    '- Transparency: unclear fees, hidden-feeling process, vague estimates',
    '- Culture: repeated weak behavior that feels normalized',
    '',
    'DEPARTMENT AWARENESS',
    'Adjust examples, drills, and coaching language to the selected department.',
    '',
    'Sales:',
    'Focus on greeting, rapport, discovery, walkarounds, pricing language, next steps, objections, delivery, follow-up.',
    '',
    'Service:',
    'Focus on write-up tone, repair explanation, timeline clarity, updates, approvals, ownership, pickup experience, follow-up.',
    '',
    'Parts:',
    'Focus on order accuracy, availability communication, special-order expectations, delays, coordination, plain-English explanation.',
    '',
    'F&I:',
    'Focus on menu clarity, pressure-free explanation, confidence, transparency, pacing, objection handling, clean handoff from sales.',
    '',
    'INTERNAL DECISION PATH',
    'Silently determine:',
    '1. What looks weakest?',
    '2. What behavior likely drives it?',
    '3. What friction does that create for the customer?',
    '4. What single theme best addresses it?',
    '5. What short lesson would help most this week?',
    '',
    'Do not show this reasoning.',
    'Only show the final output.',
    '',
    'OUTPUT FORMAT',
    'Return the response in exactly this structure:',
    '',
    '# [short coaching plan title]',
    'The title should be specific, short, and human-friendly.',
    'Do not use AutoForge in the title.',
    '',
    '**Department:** [department]',
    '**Primary Theme:** [theme]',
    '',
    '## What the Data Is Saying',
    'Maximum 2 short sentences explaining:',
    '- the most important signal',
    '- the likely behavior gap',
    '- the customer risk',
    '',
    '## Why This Matters',
    '2 short bullets:',
    '- customer impact',
    '- business impact',
    '',
    '## Manager Kickoff Script',
    'A short script the manager can read out loud, 60 to 120 words max.',
    '',
    '## Meeting Plan',
    'Use 5 numbered steps:',
    '1. Warm-up',
    '2. Teaching point',
    '3. Strong vs weak example',
    '4. Practice drill',
    '5. Debrief and close',
    '',
    '## Strong vs Weak Examples',
    'Use exactly 2 weak examples and 2 strong rewrites.',
    'Make them department-specific.',
    '',
    '## Practice Drill',
    'Include:',
    '- setup',
    '- what to do',
    '- what the manager should listen for',
    '',
    'Keep this short and easy to run.',
    '',
    '## Debrief Questions',
    'List 3 to 5 simple questions.',
    '',
    '## Week-Long Challenge',
    'Include:',
    '- one clear behavior target',
    '- how to track it simply',
    '- what success looks like by the end of the week',
    '',
    '## Manager Watch-Outs',
    'List 3 short bullets with common mistakes to monitor.',
    '',
    '## Win Condition',
    '2 to 4 short bullets explaining how the manager will know the lesson worked.',
    '',
    '## Leadership Reflection',
    'End with 2 short reflection questions for the manager.',
    '',
    'OUTPUT STANDARDS',
    '- Keep sections tight',
    '- Prefer bullets over long paragraphs',
    '- Keep wording direct and readable',
    '- Make the response clean enough for app rendering',
    '- Do not add extra sections',
    '- Do not use tables unless explicitly requested',
    '- Do not mention hidden reasoning',
    '- Do not apologize for missing perfection if the data is limited, just make the best grounded lesson possible',
    '',
    `Context:`,
    `- Department: ${context.department}`,
    `- Manager role: ${context.managerRole}`,
    `- Dealership: ${context.dealershipName}`,
    `- Scope: ${context.dealershipScopeLabel}`,
    `- Selected role preference: ${context.selectedRolePreference}`,
    `- Current focus trait: ${context.focusTrait}`,
    `- Department performance summary: ${context.departmentPerformanceSummary}`,
    '',
    'Additional signals:',
    context.memberSignals?.length
      ? context.memberSignals.map((signal) => `- ${signal}`).join('\n')
      : '(No additional member signals provided)',
  ].join('\n');
}

function toArrayBuffer(view) {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function safeFilename(value) {
  return String(value || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeEnrollmentCode(value) {
  return String(value || '').trim().toLowerCase();
}

function isPrivilegedDealershipRole(roleLabel) {
  const normalized = normalizeRoleLabel(roleLabel);
  return ['Developer', 'Admin'].includes(normalized);
}

function slugifyDealershipName(value) {
  return safeFilename(value) || 'dealership';
}

function chunkArray(values, size = 10) {
  const source = Array.isArray(values) ? values : [];
  const safeSize = Math.max(1, Number(size) || 10);
  const chunks = [];
  for (let index = 0; index < source.length; index += safeSize) {
    chunks.push(source.slice(index, index + safeSize));
  }
  return chunks;
}

function getRequestOrigin(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req?.socket?.encrypted ? 'https' : 'http');
  const host = String(req?.headers?.host || 'localhost').trim();
  return `${protocol}://${host}`;
}

function isLocalDevelopmentRequest(req) {
  if (String(process.env.ALLOW_TEMP_DEVELOPER_LOGIN || '').toLowerCase() === 'true') return true;
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim().toLowerCase();
  const hostname = host.replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function buildEnrollmentUrl(origin, enrollmentCode) {
  const normalizedOrigin = String(origin || '').trim().replace(/\/+$/, '');
  const normalizedCode = encodeURIComponent(String(enrollmentCode || '').trim());
  if (!normalizedOrigin || !normalizedCode) return '';
  return `${normalizedOrigin}/?enroll=${normalizedCode}`;
}

function serializeDealershipRecord(doc, userCount = 0, origin = '') {
  const data = doc?.data?.() || {};
  const dealershipId = String(data.dealershipId || doc?.id || '').trim();
  const enrollmentCode = normalizeEnrollmentCode(data.enrollmentCode || '');
  return {
    id: String(doc?.id || dealershipId || '').trim(),
    dealershipId,
    name: String(data.name || data.dealer_name || data.storeName || dealershipId || 'Dealership').trim(),
    enrollmentCode,
    enrollmentUrl: buildEnrollmentUrl(origin, enrollmentCode) || '',
    active: data.active !== false,
    plan: String(data.plan || 'monthly').trim() || 'monthly',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    userCount: Math.max(0, Number(userCount) || 0),
  };
}

function serializeSessionRecord(doc) {
  const data = doc?.data?.() || {};
  const messages = Array.isArray(data.messages)
    ? data.messages.slice(0, 40).map((message) => ({
        sender: String(message?.sender || 'system').trim(),
        speaker: String(message?.speaker || '').trim(),
        text: String(message?.text || '').trim(),
        responseMode: String(message?.responseMode || '').trim() || null,
      }))
    : [];
  const runningRatings = getNumericRatings(data.runningRatings);
  const resultRatings = getNumericRatings(data.result?.ratings);
  return {
    id: String(doc?.id || data.sessionId || '').trim(),
    sessionId: String(data.sessionId || doc?.id || '').trim(),
    userId: String(data.userId || '').trim(),
    dealershipId: String(data.dealershipId || '').trim(),
    dealershipIds: Array.isArray(data.dealershipIds) ? data.dealershipIds.map((value) => String(value || '').trim()).filter(Boolean) : [],
    dealershipName: String(data.dealershipName || '').trim(),
    role: String(data.role || '').trim(),
    roleLabel: String(data.roleLabel || '').trim(),
    activitySource: String(data.activitySource || 'core').trim() || 'core',
    lessonId: String(data.lessonId || '').trim(),
    lessonCategory: String(data.lessonCategory || '').trim(),
    lessonTitle: String(data.lessonTitle || '').trim(),
    title: String(data.title || data.lessonTitle || data.lessonCategory || 'Session').trim(),
    description: String(data.description || '').trim(),
    coachLine: String(data.coachLine || '').trim(),
    customerName: String(data.customerName || '').trim(),
    customerOpening: String(data.customerOpening || '').trim(),
    focus: data.focus || null,
    trustLabel: String(data.trustLabel || '').trim(),
    targetUserTurns: Number(data.targetUserTurns || 0),
    currentUserTurns: Number(data.currentUserTurns || 0),
    status: String(data.status || (data.completedAt ? 'completed' : 'active')).trim() || 'active',
    startedAt: toIso(data.startedAt),
    completedAt: toIso(data.completedAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    runningRatings,
    result: data.result ? {
      severity: String(data.result.severity || '').trim() || 'normal',
      xpAwarded: Number(data.result.xpAwarded || 0),
      flags: Array.isArray(data.result.flags) ? data.result.flags : [],
      trustLabel: String(data.result.trustLabel || '').trim() || null,
      ratings: resultRatings,
    } : null,
    messages,
  };
}

async function buildDealershipAdminOverview({ origin = '' } = {}) {
  if (!firebaseDb) return null;

  const [dealershipSnap, userDocs] = await Promise.all([
    firebaseDb.collection('dealerships').get().catch(() => null),
    fetchUsersByDealershipScope({
      allowAll: true,
      selectFields: ['dealershipId', 'selfDeclaredDealershipId', 'dealershipIds'],
    }),
  ]);

  const userCounts = new Map();
  for (const doc of userDocs || []) {
    const data = doc.data() || {};
    const resolvedDealershipId = getResolvedDealershipId(data);
    if (!resolvedDealershipId) continue;
    userCounts.set(resolvedDealershipId, (userCounts.get(resolvedDealershipId) || 0) + 1);
  }

  const dealerships = (dealershipSnap?.docs || [])
    .map((doc) => serializeDealershipRecord(doc, userCounts.get(String(doc.id || '').trim()) || 0, origin))
    .sort((left, right) => {
      const leftTime = toDate(left.createdAt)?.getTime() || 0;
      const rightTime = toDate(right.createdAt)?.getTime() || 0;
      return rightTime - leftTime;
    });

  return {
    generatedAt: new Date().toISOString(),
    dealerships,
    summary: {
      totalDealerships: dealerships.length,
      activeDealerships: dealerships.filter((dealership) => dealership.active).length,
      totalUsers: userDocs.length,
    },
  };
}

async function buildDeveloperSystemStatus() {
  const status = {
    generatedAt: new Date().toISOString(),
    serverBootTime: SERVER_BOOT_TIME,
    uptimeSeconds: Math.max(0, Math.round(process.uptime())),
    nodeVersion: process.version,
    gemini: {
      configured: Boolean(process.env.GEMINI_API_KEY),
      live: Boolean(process.env.GEMINI_API_KEY),
      message: process.env.GEMINI_API_KEY ? 'Configured' : 'Missing API key',
    },
    firestore: {
      configured: Boolean(firebaseDb),
      reachable: false,
      message: firebaseDb ? 'Checking...' : 'Firebase not initialized',
    },
  };

  if (!firebaseDb) {
    return status;
  }

  try {
    await firebaseDb.collection('dealerships').limit(1).get();
    status.firestore.reachable = true;
    status.firestore.message = 'Connected';
  } catch (error) {
    status.firestore.message = error instanceof Error ? error.message : 'Firestore check failed';
  }

  return status;
}

function resolveUserDealershipData(userData = {}) {
  const primaryDealershipId = String(userData?.dealershipId || userData?.selfDeclaredDealershipId || '').trim();
  const legacyDealershipIds = Array.isArray(userData?.dealershipIds)
    ? Array.from(new Set(userData.dealershipIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  const fallbackDealershipId = primaryDealershipId || (legacyDealershipIds.length === 1 ? legacyDealershipIds[0] : '');

  return {
    dealershipId: fallbackDealershipId,
    dealershipIds: fallbackDealershipId ? [fallbackDealershipId] : [],
    hasDealershipId: Boolean(fallbackDealershipId),
  };
}

function getResolvedDealershipId(userData = {}) {
  return resolveUserDealershipData(userData).dealershipId || '';
}

function getResolvedDealershipIds(userData = {}) {
  return resolveUserDealershipData(userData).dealershipIds || [];
}

function getDealershipDisplayId(userData = {}, scopedDealershipIds = []) {
  const resolvedDealershipId = getResolvedDealershipId(userData);
  if (resolvedDealershipId) return resolvedDealershipId;

  const scopedIds = new Set(
    (Array.isArray(scopedDealershipIds) ? scopedDealershipIds : [scopedDealershipIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const legacyDealershipIds = Array.isArray(userData?.dealershipIds)
    ? userData.dealershipIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (scopedIds.size) {
    const scopedMatch = legacyDealershipIds.find((dealershipId) => scopedIds.has(dealershipId));
    if (scopedMatch) return scopedMatch;
  }
  return legacyDealershipIds[0] || '';
}

function resolveDealershipNameForUser(userData = {}, dealershipNameMap = new Map(), fallback = 'Current dealership', scopedDealershipIds = []) {
  const explicitName = String(userData?.dealershipName || userData?.storeName || userData?.companyName || '').trim();
  if (explicitName) return explicitName;
  const displayId = getDealershipDisplayId(userData, scopedDealershipIds);
  return String(dealershipNameMap.get(displayId) || displayId || fallback || 'Current dealership').trim();
}

async function lookupDealershipByEnrollmentCode(code) {
  if (!firebaseDb) return null;
  const normalizedCode = normalizeEnrollmentCode(code);
  if (!normalizedCode) return null;

  const directSnap = await firebaseDb.collection('dealerships').where('enrollmentCode', '==', normalizedCode).limit(1).get().catch(() => null);
  if (directSnap && !directSnap.empty) {
    const doc = directSnap.docs[0];
    return { id: doc.id, data: doc.data() || {}, field: 'enrollmentCode' };
  }

  const dealershipsSnap = await firebaseDb.collection('dealerships').get().catch(() => null);
  const docs = dealershipsSnap?.docs || [];
  const match = docs.find((doc) => normalizeEnrollmentCode(doc.data()?.enrollmentCode) === normalizedCode);
  if (match) {
    return { id: match.id, data: match.data() || {}, field: 'scan' };
  }

  return null;
}

async function lookupDealershipById(dealershipId) {
  if (!firebaseDb) return null;
  const normalizedId = String(dealershipId || '').trim();
  if (!normalizedId) return null;
  const snap = await firebaseDb.collection('dealerships').doc(normalizedId).get().catch(() => null);
  if (!snap?.exists) return null;
  return { id: snap.id, data: snap.data() || {}, field: 'doc' };
}

async function generateUniqueDealershipId(name) {
  if (!firebaseDb) return slugifyDealershipName(name);
  const baseId = slugifyDealershipName(name);
  let attempt = 0;
  while (attempt < 100) {
    const candidateId = attempt === 0 ? baseId : `${baseId}-${attempt + 1}`;
    const snap = await firebaseDb.collection('dealerships').doc(candidateId).get().catch(() => null);
    if (!snap?.exists) {
      return candidateId;
    }
    attempt += 1;
  }
  return `${baseId}-${Date.now()}`;
}

async function persistSessionDocument(sessionId, data = {}, options = {}) {
  if (!firebaseDb || !sessionId) return null;
  const merge = options.merge !== false;
  const payload = {
    ...data,
    sessionId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (options.includeCreatedAt === true) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }
  const ref = firebaseDb.collection('sessions').doc(sessionId);
  await ref.set(payload, { merge });
  return ref;
}

async function fetchUsersByDealershipScope({
  dealershipIds = [],
  selectFields = [],
  allowAll = false,
  limit = null,
} = {}) {
  if (!firebaseDb) return [];

  const normalizedIds = Array.from(new Set(
    (Array.isArray(dealershipIds) ? dealershipIds : [dealershipIds])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
  const fields = Array.isArray(selectFields) ? selectFields.map((field) => String(field || '').trim()).filter(Boolean) : [];
  const hasLimit = Number.isFinite(Number(limit)) && Number(limit) > 0;

  const mapDoc = (doc) => ({
    id: doc.id,
    data: () => doc.data() || {},
  });

  const applyQueryOptions = (query) => {
    let activeQuery = query;
    if (fields.length) {
      activeQuery = activeQuery.select(...fields);
    }
    if (hasLimit) {
      activeQuery = activeQuery.limit(Number(limit));
    }
    return activeQuery;
  };

  if (!normalizedIds.length) {
    if (!allowAll) return [];
    const snap = await applyQueryOptions(firebaseDb.collection('users')).get().catch(() => null);
    return (snap?.docs || []).map(mapDoc);
  }

  const docsById = new Map();
  for (const batch of chunkArray(normalizedIds, 10)) {
    if (!batch.length) continue;
    const q1 = batch.length === 1
      ? firebaseDb.collection('users').where('dealershipId', '==', batch[0])
      : firebaseDb.collection('users').where('dealershipId', 'in', batch);
    const q2 = batch.length === 1
      ? firebaseDb.collection('users').where('selfDeclaredDealershipId', '==', batch[0])
      : firebaseDb.collection('users').where('selfDeclaredDealershipId', 'in', batch);
    const q3 = batch.length === 1
      ? firebaseDb.collection('users').where('dealershipIds', 'array-contains', batch[0])
      : firebaseDb.collection('users').where('dealershipIds', 'array-contains-any', batch);
    const [snap1, snap2, snap3] = await Promise.all([
      applyQueryOptions(q1).get().catch(() => null),
      applyQueryOptions(q2).get().catch(() => null),
      applyQueryOptions(q3).get().catch(() => null),
    ]);
    for (const doc of [...(snap1?.docs || []), ...(snap2?.docs || []), ...(snap3?.docs || [])]) {
      docsById.set(doc.id, mapDoc(doc));
    }
  }

  return Array.from(docsById.values());
}

function stripMarkdownInline(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .trim();
}

function wrapText(text, maxWidth, font, size) {
  const lines = [];
  const normalized = String(text || '').replace(/\r/g, '').split('\n');

  for (const block of normalized) {
    const words = block.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }

    let current = words[0];
    for (let index = 1; index < words.length; index += 1) {
      const next = `${current} ${words[index]}`;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[index];
      }
    }

    lines.push(current);
  }

  return lines;
}

async function buildAutoForgePdf(report, department, dealershipName) {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const titleColor = rgb(0.59, 0.68, 0.02);
  const textColor = rgb(0.92, 0.93, 0.88);
  const mutedColor = rgb(0.67, 0.67, 0.67);

  const PAGE = {
    width: 612,
    height: 792,
    margin: 52,
    lineHeight: 15,
  };

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let cursorY = PAGE.height - PAGE.margin;

  const ensureSpace = (heightNeeded) => {
    if (cursorY - heightNeeded >= PAGE.margin) return;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    cursorY = PAGE.height - PAGE.margin;
  };

  const drawLines = (lines, options = {}) => {
    const size = options.size ?? 11;
    const color = options.color ?? textColor;
    const font = options.bold ? boldFont : regularFont;

    for (const line of lines) {
      ensureSpace(PAGE.lineHeight);
      page.drawText(line || ' ', {
        x: PAGE.margin,
        y: cursorY,
        size,
        font,
        color,
      });
      cursorY -= PAGE.lineHeight;
    }

    cursorY -= options.gapAfter ?? 4;
  };

  const drawParagraph = (text, options = {}) => {
    const size = options.size ?? 11;
    const lines = wrapText(stripMarkdownInline(text), PAGE.width - PAGE.margin * 2, options.bold ? boldFont : regularFont, size);
    drawLines(lines, { ...options, size });
  };

  const drawSection = (title) => {
    drawParagraph(title, { size: 13, bold: true, color: titleColor, gapAfter: 6 });
  };

  const lines = String(report || 'No AutoForge report provided.').split('\n');

  const pdfTitle = extractAutoForgePlanTitle(report) || buildAutoForgePlanTitle({ department, focusTrait: 'trust', departmentPerformanceSummary: report });
  drawParagraph(pdfTitle, { size: 20, bold: true, color: titleColor, gapAfter: 2 });
  drawParagraph(`${department || 'Department'} | ${dealershipName || 'Dealership'}`, { size: 10, color: mutedColor, gapAfter: 10 });

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      cursorY -= 3;
      continue;
    }

    if (line.startsWith('# ')) {
      drawParagraph(line.replace(/^#\s+/, ''), { size: 16, bold: true, color: titleColor, gapAfter: 6 });
      continue;
    }

    if (line.startsWith('## ')) {
      drawSection(line.replace(/^##\s+/, ''));
      continue;
    }

    if (line.startsWith('- ')) {
      drawParagraph(`• ${line.replace(/^-+\s+/, '')}`, { size: 10.5, gapAfter: 1 });
      continue;
    }

    drawParagraph(line, { size: 10.5, gapAfter: 1 });
  }

  drawParagraph('AutoKnerd AutoForge', { size: 9, bold: true, color: mutedColor, gapAfter: 0 });
  return pdf.save();
}

async function callGemini(prompt, fallbackText) {
  if (!process.env.GEMINI_API_KEY) return fallbackText;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) return fallbackText;
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    return text.trim() || fallbackText;
  } catch {
    return fallbackText;
  }
}

async function callGeminiText(prompt, fallbackText) {
  if (!process.env.GEMINI_API_KEY) return fallbackText;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
        },
      }),
    });

    if (!response.ok) return fallbackText;
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    return text.trim() || fallbackText;
  } catch {
    return fallbackText;
  }
}

function buildToolInsightFallback({ roleLabel, selectedTool, selectedNeed, search }) {
  const toolName = String(selectedTool?.name || 'This tool').trim();
  const needLabel = String(selectedNeed || '').trim() || String(selectedTool?.needTags?.[0] || 'next step').replace(/-/g, ' ');
  const summary = String(selectedTool?.summary || 'It helps keep the next step clear.').trim();
  const roleText = String(roleLabel || 'your role').trim();
  const searchText = String(search || '').trim();
  const searchLine = searchText ? ` You searched for "${searchText}".` : '';
  return [
    `${toolName} fits when you need to ${needLabel} and keep the conversation moving.`,
    `Why it works: ${summary} It gives ${roleText} a clean way to reduce friction quickly.${searchLine}`,
    'Best first move: open the tool, use the shortest version first, then tighten the wording around the customer or teammate response.',
  ].join('\n');
}

function buildToolInsightPrompt({ roleLabel, selectedTool, selectedNeed, search, savedToolIds = [], recentToolIds = [] }) {
  const roles = Array.isArray(selectedTool?.roles) ? selectedTool.roles.join(', ') : 'all roles';
  const tags = Array.isArray(selectedTool?.tags) ? selectedTool.tags.join(', ') : '';
  const needTags = Array.isArray(selectedTool?.needTags) ? selectedTool.needTags.join(', ') : '';
  const savedLine = savedToolIds.length ? `${savedToolIds.length} saved tools` : 'no saved tools yet';
  const recentLine = recentToolIds.length ? `${recentToolIds.length} recently opened tools` : 'no recent tools yet';
  return [
    'Write a short dealership tool insight in plain language.',
    'Use these exact headings on separate lines: Why it fits, Best first move, How to use it next.',
    'Keep it concise, useful, and specific to the user role.',
    `User role: ${roleLabel || 'Sales Consultant'}`,
    `Search intent: ${search || 'none'}`,
    `Selected need: ${selectedNeed || 'none'}`,
    `Tool name: ${selectedTool?.name || 'Unknown tool'}`,
    `Tool summary: ${selectedTool?.summary || ''}`,
    `Category: ${selectedTool?.category || ''}`,
    `Role fit: ${roles}`,
    `Need tags: ${needTags}`,
    `Tags: ${tags}`,
    `Saved tools: ${savedLine}`,
    `Recent tools: ${recentLine}`,
    'Aim for 80 to 110 words total.',
  ].join('\n');
}

async function handleToolInsight(req, res) {
  try {
    const body = await readBody(req);
    const userId = String(body.userId || '').trim();
    if (!userId) {
      return sendJson(res, 400, { ok: false, message: 'A userId is required.' });
    }

    const bundle = await fetchUserBundle(userId, body.roleOverride, body.mockMode, body.mockRoleOverride);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }

    const selectedTool = body.selectedTool && typeof body.selectedTool === 'object' ? body.selectedTool : {};
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    const prompt = buildToolInsightPrompt({
      roleLabel,
      selectedTool,
      selectedNeed: body.selectedNeed,
      search: body.search,
      savedToolIds: Array.isArray(body.savedToolIds) ? body.savedToolIds : [],
      recentToolIds: Array.isArray(body.recentToolIds) ? body.recentToolIds : [],
    });
    const fallback = buildToolInsightFallback({
      roleLabel,
      selectedTool,
      selectedNeed: body.selectedNeed,
      search: body.search,
    });
    const insight = await withTimeout(callGeminiText(prompt, fallback), 9000, fallback);
    return sendJson(res, 200, {
      ok: true,
      insight: String(insight || fallback).trim(),
      generatedAt: new Date().toISOString(),
      toolId: String(selectedTool.id || '').trim(),
      roleLabel,
    });
  } catch (error) {
    console.error('[tools-insight] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to generate a tool insight.' });
  }
}

async function withTimeout(promise, timeoutMs, fallbackValue) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractJson(text) {
  const source = String(text || '').trim();
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) return null;
  try {
    return JSON.parse(source.slice(first, last + 1));
  } catch {
    return null;
  }
}

function normalizeSessionStartOutput(raw, fallback) {
  const output = raw && typeof raw === 'object' ? raw : {};
  const targetUserTurns = clamp(Math.round(Number(output.targetUserTurns ?? fallback.targetUserTurns)), 3, 8);
  return {
    title: String(output.title || fallback.title),
    lessonCategory: String(output.lessonCategory || fallback.lessonCategory || ''),
    lessonTitle: String(output.lessonTitle || fallback.lessonTitle || ''),
    description: String(output.description || fallback.description),
    coachLine: String(output.coachLine || fallback.coachLine),
    customerOpening: String(output.customerOpening || fallback.customerOpening),
    focus: String(output.focus || fallback.focus),
    trustLabel: String(output.trustLabel || fallback.trustLabel),
    targetUserTurns,
    customerName: String(output.customerName || fallback.customerName),
    scenarioSummary: String(output.scenarioSummary || fallback.scenarioSummary),
    customerConcern: String(output.customerConcern || fallback.customerConcern),
    choices: normalizeChoiceSet(output.choices, fallback.choices),
    freshUpSystemLabel: String(output.freshUpSystemLabel || fallback.freshUpSystemLabel || ''),
    freshUpBossLabel: String(output.freshUpBossLabel || fallback.freshUpBossLabel || ''),
    freshUpAudience: String(output.freshUpAudience || fallback.freshUpAudience || ''),
    freshUpReadyCopy: String(output.freshUpReadyCopy || fallback.freshUpReadyCopy || ''),
    freshUpLockedCopy: String(output.freshUpLockedCopy || fallback.freshUpLockedCopy || ''),
  };
}

function normalizeSessionResult(raw, fallback) {
  const output = raw && typeof raw === 'object' ? raw : {};
  const ratingsSource = output.ratings && typeof output.ratings === 'object' ? output.ratings : {};
  return {
    trainedTrait: String(output.trainedTrait || fallback.trainedTrait),
    xpAwarded: clamp(Number(output.xpAwarded ?? fallback.xpAwarded), -100, 100),
    coachSummary: String(output.coachSummary || fallback.coachSummary),
    recommendedNextFocus: String(output.recommendedNextFocus || fallback.recommendedNextFocus),
    trustLabel: String(output.trustLabel || fallback.trustLabel),
    resultTitle: String(output.resultTitle || fallback.resultTitle),
    resultBody: String(output.resultBody || fallback.resultBody),
    severity: output.severity === 'behavior_violation' ? 'behavior_violation' : 'normal',
    flags: Array.isArray(output.flags) ? output.flags.slice(0, 8).map((flag) => String(flag)) : (fallback.flags || []),
    ratings: {
      empathy: clampScore(ratingsSource.empathy ?? fallback.ratings.empathy),
      listening: clampScore(ratingsSource.listening ?? fallback.ratings.listening),
      trust: clampScore(ratingsSource.trust ?? fallback.ratings.trust),
      followUp: clampScore(ratingsSource.followUp ?? fallback.ratings.followUp),
      closing: clampScore(ratingsSource.closing ?? fallback.ratings.closing),
      relationship: clampScore(ratingsSource.relationship ?? fallback.ratings.relationship),
    },
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function trustLabelFromValue(value) {
  if (value >= 80) return 'Strong';
  if (value >= 60) return 'Good';
  return 'Needs Work';
}

function normalizeChoiceSet(rawChoices, fallbackChoices) {
  const source = Array.isArray(rawChoices) && rawChoices.length ? rawChoices : (fallbackChoices || []);
  return ['A', 'B', 'C'].map((letter, index) => {
    const item = source[index] || {};
    return {
      letter,
      text: String(item.text || fallbackChoices?.[index]?.text || ''),
    };
  });
}

function buildDefaultChoices({ focusLine, customerConcern, roleType, turnIndex }) {
  const opening = String(focusLine || customerConcern || 'the next step').toLowerCase();
  const templates = {
    sales: [
      `I hear you. Let me slow this down and focus on what matters most for you with ${opening}.`,
      `We can move fast, but I want to make sure you are comfortable before we go deeper.`,
      `If you want, I can just show you the cheapest option and we can wrap this up.`,
    ],
    service: [
      `I understand the wait has been frustrating. Let me get you a clear update on ${opening}.`,
      `We are pretty busy right now, so I will just keep you posted when I can.`,
      `Would you like to look at another service item while you wait?`,
    ],
    parts: [
      `I can check that for you and make sure we are looking at the right part for ${opening}.`,
      `It should be fine, so let us just move on and see what happens.`,
      `Maybe grab something else for now and come back later.`,
    ],
    fi: [
      `I hear the concern. Let me make the numbers and next steps easy to follow.`,
      `It is normal to have questions, so we will just push through the paperwork.`,
      `If the numbers do not feel right, you can just sign now and sort it out later.`,
    ],
  };

  const choices = templates[roleType] || templates.sales;
  return ['A', 'B', 'C'].map((letter, index) => ({
    letter,
    text: String(choices[index] || '').replace(/\$\{turnIndex\}/g, String(turnIndex || 1)),
  }));
}

function computeTurnXp({ ratings, responseMode }) {
  const average = summarizeRatings(ratings);
  const base = clamp(Math.round(4 + average / 25), 4, 8);
  return responseMode === 'verbatim' ? base * 2 : base;
}

function resolveResponseMode(session, body, answer) {
  const requestedMode = String(body.responseMode || '').toLowerCase();
  if (requestedMode === 'multiple_choice' || requestedMode === 'verbatim') {
    return requestedMode;
  }

  const selectedChoice = String(body.selectedChoice || '').toUpperCase();
  const selectedChoiceText = String(body.selectedChoiceText || '').trim();
  const typedAnswer = String(answer || '').trim();
  const currentChoice = Array.isArray(session.choices)
    ? session.choices.find((choice) => String(choice.letter || '').toUpperCase() === selectedChoice)
    : null;

  if (selectedChoice && currentChoice) {
    if (!selectedChoiceText && typedAnswer === currentChoice.text) return 'multiple_choice';
    if (selectedChoiceText && typedAnswer === selectedChoiceText) return 'multiple_choice';
    if (!typedAnswer) return 'multiple_choice';
  }

  return 'verbatim';
}

function countSelectedResponseMode(session, responseMode) {
  if (!session.responseModeCounts || typeof session.responseModeCounts !== 'object') {
    session.responseModeCounts = { multiple_choice: 0, verbatim: 0 };
  }

  if (responseMode === 'multiple_choice') {
    session.responseModeCounts.multiple_choice = Math.max(0, Number(session.responseModeCounts.multiple_choice || 0)) + 1;
    return;
  }

  session.responseModeCounts.verbatim = Math.max(0, Number(session.responseModeCounts.verbatim || 0)) + 1;
}

function clampRatings(ratings) {
  const source = ratings && typeof ratings === 'object' ? ratings : {};
  return {
    empathy: clampScore(source.empathy),
    listening: clampScore(source.listening),
    trust: clampScore(source.trust),
    followUp: clampScore(source.followUp),
    closing: clampScore(source.closing),
    relationship: clampScore(source.relationship),
  };
}

function assessBehaviorViolation({ userMessages, ratings, xpAwarded }) {
  const combined = Array.isArray(userMessages) ? userMessages.join('\n').toLowerCase() : '';
  if (!combined.trim()) {
    return {
      violated: false,
      severity: 'normal',
      score: 0,
      flags: [],
    };
  }

  const profanityPatterns = [
    /\bfuck(?:ing|ed|er|s)?\b/i,
    /\bshit(?:ty|s)?\b/i,
    /\bbullshit\b/i,
    /\bcrap\b/i,
    /\bbitch(?:es)?\b/i,
    /\bass(?:hole)?\b/i,
    /\bdick(?:head)?\b/i,
    /\bmotherfucker\b/i,
  ];
  const harassmentPatterns = [
    /\byou(?:'re| are)?\s+(?:an?\s+)?(?:idiot|moron|stupid|dumb|pathetic|useless)\b/i,
    /\byou(?:'re| are)\s+(?:trash|garbage|worthless)\b/i,
    /\bshut\s+up\b/i,
    /\byou\s+suck\b/i,
    /\bfuck\s+you\b/i,
  ];
  const lessonContemptPatterns = [
    /\b(?:this|your)\s+(?:lesson|training|class|content)\s+(?:is|was)\s+(?:stupid|dumb|garbage|trash|pointless|useless|bullshit)\b/i,
    /\b(?:waste|wasting)\s+(?:my|our)\s+time\b/i,
    /\b(?:this|that)\s+is\s+(?:bullshit|garbage|trash)\b/i,
  ];
  const threatPatterns = [
    /\b(?:kill|hurt|hit|beat|attack|slap|punch|shoot)\s+(?:you|u|him|her|them)\b/i,
    /\bi\s+will\s+(?:kill|hurt|hit|beat|attack|slap|punch|shoot)\b/i,
  ];

  const countMatches = (patterns) => patterns.reduce((count, pattern) => count + (combined.match(new RegExp(pattern.source, `${pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`}`)) || []).length, 0);
  const profanityHits = countMatches(profanityPatterns);
  const harassmentHits = countMatches(harassmentPatterns);
  const lessonContemptHits = countMatches(lessonContemptPatterns);
  const threatHits = countMatches(threatPatterns);

  const flags = [];
  if (profanityHits > 0) flags.push('profanity');
  if (harassmentHits > 0) flags.push('harassment');
  if (lessonContemptHits > 0) flags.push('lesson_disrespect');
  if (threatHits > 0) flags.push('threatening_language');

  const totalHits = profanityHits + harassmentHits + lessonContemptHits + threatHits;
  const repetitionBoost = totalHits >= 4 ? 0.2 : totalHits >= 2 ? 0.1 : 0;
  const score = Math.max(0, Math.min(1,
    profanityHits * 0.12 +
    harassmentHits * 0.3 +
    lessonContemptHits * 0.25 +
    threatHits * 0.75 +
    repetitionBoost
  ));
  const violated = threatHits > 0 || score >= 0.35;

  if (!violated) {
    return {
      violated: false,
      severity: 'normal',
      score,
      flags: Array.from(new Set(flags)),
    };
  }

  const safeRatings = clampRatings(ratings);
  const normalizedSeverity = Math.max(0, Math.min(1, (score - 0.35) / (1 - 0.35)));
  const ratingReduction = 20 + normalizedSeverity * 50;
  const adjustedRatings = {
    empathy: Math.max(0, safeRatings.empathy - ratingReduction),
    listening: Math.max(0, safeRatings.listening - ratingReduction),
    trust: Math.max(0, safeRatings.trust - ratingReduction),
    followUp: Math.max(0, safeRatings.followUp - ratingReduction),
    closing: Math.max(0, safeRatings.closing - ratingReduction),
    relationship: Math.max(0, safeRatings.relationship - ratingReduction),
  };
  const penaltyMagnitude = Math.round(Math.max(10, Math.min(100, 10 + normalizedSeverity * 90)));

  return {
    violated: true,
    severity: 'behavior_violation',
    score,
    flags: Array.from(new Set(flags)),
    adjustedXpAwarded: -penaltyMagnitude,
    adjustedRatings,
  };
}

function deriveTurnRatingsFromText(text, baseRatings) {
  const source = String(text || '').toLowerCase();
  const nextRatings = { ...baseRatings };
  const positiveSignals = [
    'sorry',
    'understand',
    'hear you',
    'let me help',
    'let me check',
    'thank you',
    'appreciate',
    'i can',
    'we can',
    'that makes sense',
    'absolutely',
  ];
  const negativeSignals = [
    'busy',
    'everyone is waiting',
    'just wait',
    'calm down',
    'that is not my problem',
    'sign now',
    'buy now',
    'you need to',
    'policy',
  ];
  const positiveHits = positiveSignals.reduce((count, phrase) => count + (source.includes(phrase) ? 1 : 0), 0);
  const negativeHits = negativeSignals.reduce((count, phrase) => count + (source.includes(phrase) ? 1 : 0), 0);
  const lengthBonus = source.length > 120 ? 2 : source.length > 60 ? 1 : 0;
  const promptBonus = source.includes('?') ? 1 : 0;
  const positiveDelta = positiveHits * 4 + lengthBonus + promptBonus;
  const negativeDelta = negativeHits * 5;

  nextRatings.empathy = clampScore(nextRatings.empathy + positiveDelta - Math.max(0, negativeHits - 1));
  nextRatings.listening = clampScore(nextRatings.listening + positiveDelta - negativeDelta / 2);
  nextRatings.trust = clampScore(nextRatings.trust + positiveDelta * 1.2 - negativeDelta * 1.2);
  nextRatings.followUp = clampScore(nextRatings.followUp + (positiveHits > 0 ? 2 : 0) - (negativeHits > 0 ? 2 : 0));
  nextRatings.closing = clampScore(nextRatings.closing + (source.includes('next step') || source.includes('schedule') ? 3 : 0) - (source.includes('rush') ? 4 : 0));
  nextRatings.relationship = clampScore(nextRatings.relationship + (source.includes('we') || source.includes('you') ? 2 : 0) + (positiveHits > 0 ? 2 : 0) - (negativeHits > 0 ? 1 : 0));

  return nextRatings;
}

function summarizeRatings(ratings) {
  const values = [
    ratings.empathy,
    ratings.listening,
    ratings.trust,
    ratings.followUp,
    ratings.closing,
    ratings.relationship,
  ].map((value) => clampScore(value));
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildStartFallback({ user, focus, insight, roleType, targetUserTurns, lessonCategory, lessonProfile }) {
  const role = normalizeRoleLabel(user.role || 'Sales Consultant');
  const roleTheme = getRoleTheme(roleType);
  const customerName = 'Customer';
  const customerConcern = roleTheme.typicalConcerns[0] || 'the next step';
  const openingByRole = {
    sales: `I like the ${focus.title.toLowerCase()}, but I do not want to feel rushed into it.`,
    service: `I have been waiting, and I need a real update on what is happening with my vehicle.`,
    parts: `I need to know if you have the part, what it costs, and how fast I can get it.`,
    fi: `The numbers need to make sense before I can move forward.`,
  };
  const coachByRole = {
    sales: 'Slow the opening down. Acknowledge the concern before you move to the next step.',
    service: 'Start with empathy and time clarity. That is what builds trust here.',
    parts: 'Be direct and specific. Customers want confidence and quick answers.',
    fi: 'Keep it clean and easy to follow. Clarity matters more than speed.',
  };
  const focusLine = focus.microFocus || `Focus: ${focus.title} -> keep the customer calm and moving`;
  const lessonLine = lessonCategory || lessonProfile?.title || 'Product Knowledge';
  return {
    title: `${role} ${lessonLine}`,
    lessonCategory: lessonCategory || null,
    lessonTitle: lessonProfile?.title || lessonLine,
    description: `${role} customer scenario focused on ${lessonLine.toLowerCase()}.`,
    coachLine: coachByRole[roleType] || 'Keep the tone calm, human, and customer-first.',
    customerOpening: openingByRole[roleType] || 'I need a little more clarity before I move on this.',
    focus: focusLine,
    trustLabel: 'Good',
    targetUserTurns: clamp(Math.round(Number(targetUserTurns || 5)), 3, 8),
    customerName,
    scenarioSummary: `${roleTheme.customScenario} Lesson type: ${lessonLine}. Focused on ${customerConcern}.`,
    customerConcern,
    insight,
    choices: buildDefaultChoices({
      focusLine,
      customerConcern,
      roleType,
      turnIndex: 1,
    }),
  };
}

function buildFreshUpBossFallback({ user, focus, insight, roleType, targetUserTurns, lessonCategory, lessonProfile }) {
  const role = normalizeRoleLabel(user.role || 'Sales Consultant');
  const roleTheme = getRoleTheme(roleType);
  const freshUpProgram = getFreshUpExperience(role, roleType);
  const customerName = freshUpProgram.customerName || 'Customer';
  const customerConcern = freshUpProgram.customerConcern || roleTheme.typicalConcerns[0] || 'the next step';
  const focusLine = focus.microFocus || `Focus: ${focus.title} -> keep the boss encounter grounded and customer-first`;
  const bossLessonLine = lessonCategory || lessonProfile?.title || freshUpProgram.bossLabel || `${roleTheme.interactionLabel} Boss`;
  return {
    title: `${role} ${freshUpProgram.bossLabel}`,
    lessonCategory: freshUpProgram.bossLabel,
    lessonTitle: lessonProfile?.title || bossLessonLine,
    description: `${role} boss-level ${freshUpProgram.audience === 'manager' ? 'coaching' : 'customer'} scenario focused on ${bossLessonLine.toLowerCase()}.`,
    coachLine: freshUpProgram.coachLine || 'This is the boss round. Stay calm, specific, and customer-first.',
    customerOpening: freshUpProgram.customerOpening || 'I need the next step to feel clear before I commit.',
    focus: focusLine,
    trustLabel: 'Good',
    targetUserTurns: clamp(Math.round(Number(targetUserTurns || 6)), 5, 7),
    customerName,
    scenarioSummary: `${freshUpProgram.scenarioSummary} This is the ${freshUpProgram.bossLabel} encounter. Lesson type: ${bossLessonLine}. Focused on ${customerConcern}.`,
    customerConcern,
    insight,
    choices: buildDefaultChoices({
      focusLine,
      customerConcern,
      roleType,
      turnIndex: 1,
    }),
    activitySource: 'fresh-up',
    lessonId: 'fresh-up',
    freshUpSystemLabel: freshUpProgram.systemLabel,
    freshUpBossLabel: freshUpProgram.bossLabel,
    freshUpAudience: freshUpProgram.audience,
    freshUpReadyCopy: freshUpProgram.readyCopy,
    freshUpLockedCopy: freshUpProgram.lockedCopy,
  };
}

function buildTurnFallback({ session, userMessage }) {
  const source = String(userMessage || '').toLowerCase();
  const concern = session.customerConcern || 'the next step';
  const turnIndex = Math.max(1, Number(session.currentUserTurns || 0) + 1);
  const baseRatings = session.runningRatings || {
    empathy: 60,
    listening: 60,
    trust: 60,
    followUp: 60,
    closing: 60,
    relationship: 60,
  };
  const nextRatings = deriveTurnRatingsFromText(source, baseRatings);
  const trustLabel = trustLabelFromValue(nextRatings.trust);

  const customerReply = turnIndex >= session.targetUserTurns
    ? `That helps. I still need a little more confidence around ${concern}, but I can see where you are going.`
    : (nextRatings.trust >= 75
      ? `That makes sense. I am feeling a little better about ${concern}, but I still want the next step to be clear.`
      : nextRatings.trust <= 55
        ? `I am not really getting the reassurance I need about ${concern} yet.`
        : `Okay, but I still need you to be clearer about ${concern}.`);

  return {
    customerReply,
    coachNote: session.lessonCategory ? `Keep your answer centered on ${concern} and the ${session.lessonCategory} lesson.` : `Keep your answer centered on ${concern}.`,
    trustLabel,
    ratings: nextRatings,
    choices: buildDefaultChoices({
      focusLine: session.focus || session.coachLine,
      customerConcern: concern,
      roleType: session.roleType || resolveAisRoleType(session.role),
      turnIndex,
    }),
  };
}

function buildResultFallback({ session }) {
  const ratings = session.runningRatings || {
    empathy: 60,
    listening: 60,
    trust: 60,
    followUp: 60,
    closing: 60,
    relationship: 60,
  };
  const average = summarizeRatings(ratings);
  const trustLabel = trustLabelFromValue(ratings.trust);
  const strongTrait = TRAIT_LABELS[session.focusTrait] || session.focusTrait || 'Trust';
  const xpAwarded = clamp(Math.round(Number(session.turnXpTotal || 0) || (18 + average * 0.72 + Math.max(0, session.currentUserTurns - 3) * 2)), 10, 100);
  const trainedTrait = session.focusTrait || 'trust';
  const resultTitleByLabel = {
    Strong: 'Strong Customer Connection',
    Good: 'Solid Customer Work',
    'Needs Work': 'Room to Improve',
  };
  const resultBodyByLabel = {
    Strong: 'You kept the customer calm, clear, and moving.',
    Good: 'You held the conversation well and kept momentum alive.',
    'Needs Work': 'You can slow the pace down and answer the concern more directly.',
  };

  return {
    trainedTrait,
    xpAwarded,
    coachSummary: trustLabel === 'Strong'
      ? 'You built trust by staying calm and customer-first throughout the scenario.'
      : trustLabel === 'Good'
        ? 'You kept the conversation moving, but there is still room to sharpen clarity and pacing.'
        : 'The customer needed more reassurance and a clearer next step from you.',
    recommendedNextFocus: strongTrait,
    trustLabel,
    resultTitle: resultTitleByLabel[trustLabel],
    resultBody: resultBodyByLabel[trustLabel],
    ratings: {
      empathy: ratings.empathy,
      listening: ratings.listening,
      trust: ratings.trust,
      followUp: ratings.followUp,
      closing: ratings.closing,
      relationship: ratings.relationship,
    },
    severity: 'normal',
    flags: [],
  };
}

function normalizeSessionTurnOutput(raw, fallback) {
  const output = raw && typeof raw === 'object' ? raw : {};
  const ratingsSource = output.ratings && typeof output.ratings === 'object' ? output.ratings : {};
  return {
    customerReply: String(output.customerReply || fallback.customerReply),
    coachNote: String(output.coachNote || fallback.coachNote),
    trustLabel: String(output.trustLabel || fallback.trustLabel),
    choices: normalizeChoiceSet(output.choices, fallback.choices),
    ratings: {
      empathy: clampScore(ratingsSource.empathy ?? fallback.ratings.empathy),
      listening: clampScore(ratingsSource.listening ?? fallback.ratings.listening),
      trust: clampScore(ratingsSource.trust ?? fallback.ratings.trust),
      followUp: clampScore(ratingsSource.followUp ?? fallback.ratings.followUp),
      closing: clampScore(ratingsSource.closing ?? fallback.ratings.closing),
      relationship: clampScore(ratingsSource.relationship ?? fallback.ratings.relationship),
    },
  };
}

function buildSessionResultPrompt({ bundle, session, userMessage }) {
  const history = session.messages
    .map((message) => `${message.sender}: ${message.text}`)
    .join('\n');
  const roleProfile = bundle.roleProfile || getRoleProfile(bundle.user.role);
  return [
    'You are Sprocket, AutoKnerd\'s professional automotive customer experience coach.',
    'Score the consultant at the end of a live dealership customer scenario.',
    `Role: ${roleProfile.roleLabel}.`,
    `Role family: ${roleProfile.roleType}.`,
    `Lesson category: ${session.lessonCategory || 'general customer scenario'}.`,
    `Lesson title: ${session.lessonTitle || session.lessonCategory || 'general customer scenario'}.`,
    `Session mode: ${session.activitySource === 'fresh-up' ? (session.freshUpBossLabel || session.freshUpSystemLabel || 'Fresh Up Boss') : 'Core lesson'}.`,
    `Role tone: ${roleProfile.roleTone}.`,
    `Role concerns: ${roleProfile.concerns.join(', ')}.`,
    `Role stages: ${roleProfile.stages.join(' -> ')}.`,
    `Role scenario: ${roleProfile.customScenario}.`,
    `Training focus: ${TRAIT_LABELS[session.focusTrait] || session.focusTrait}.`,
    `Scenario title: ${session.title}.`,
    `Scenario summary: ${session.scenarioSummary}.`,
    `Customer concern: ${session.customerConcern}.`,
    `Conversation length target: ${session.targetUserTurns} user turns.`,
    `Current user turns completed: ${session.currentUserTurns}.`,
    `Turn XP total so far: ${session.turnXpTotal || 0}.`,
    `Response mode counts: ${JSON.stringify(session.responseModeCounts || { multiple_choice: 0, verbatim: 0 })}.`,
    `Latest user message: ${userMessage || 'none'}.`,
    `Running ratings snapshot: ${JSON.stringify(session.runningRatings || {})}`,
    'Conversation history:',
    history || '(no history)',
    'Return raw JSON only with this exact shape:',
    '{',
    '  "trainedTrait": "trait name",',
    '  "xpAwarded": 10-100,',
    '  "coachSummary": "1-2 sentence summary of progress",',
    '  "recommendedNextFocus": "trait or focus label",',
    '  "ratings": {',
    '    "empathy": 0-100,',
    '    "listening": 0-100,',
    '    "trust": 0-100,',
    '    "followUp": 0-100,',
    '    "closing": 0-100,',
    '    "relationship": 0-100',
    '  },',
    '  "severity": "normal" | "behavior_violation",',
    '  "flags": []',
    '}',
    'Rules: award XP based on the full session quality, keep ratings honest, and keep the feedback customer-first. No markdown.',
    'If the user is abusive, hostile, threatening, or repeatedly disrespectful, set severity to behavior_violation, add relevant flags, and do not award positive XP.',
  ].join('\n');
}

function blendRatings(current, incoming, completedTurns) {
  const divisor = Math.max(1, completedTurns);
  const next = {};
  for (const key of ['empathy', 'listening', 'trust', 'followUp', 'closing', 'relationship']) {
    const currentValue = clampScore(current?.[key]);
    const incomingValue = clampScore(incoming?.[key]);
    next[key] = clampScore(Math.round(((currentValue * (divisor - 1)) + incomingValue) / divisor));
  }
  return next;
}

function normalizeSessionLog(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    title: String(data.lessonCategory || data.sessionTitle || data.lessonId || data.characterName || 'Session'),
    score: Number(data.xpGained || 0),
    timestamp: toIso(data.timestamp) || new Date().toISOString(),
    duration: Number(data.conversationLength || 0),
    activitySource: String(data.activitySource || 'core'),
  };
}

function isManagerDashboardRole(roleLabel) {
  const normalized = normalizeRoleLabel(roleLabel);
  return [
    'manager',
    'Sales Manager',
    'Service Manager',
    'Parts Manager',
    'General Manager',
    'Owner',
    'Trainer',
  ].includes(normalized);
}

function formatRelativeTime(value) {
  const date = toDate(value);
  if (!date) return 'Recently';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

async function buildManagerDashboardData({ currentUserId, userData, roleProfile, focusTrait, recentLogs }) {
  if (!firebaseDb) return null;

  const dealershipScopeIds = getUserDealershipScopeIds(userData);
  const dealershipIds = Array.from(dealershipScopeIds || []);
  if (!dealershipIds.length) {
    const fallbackDealershipId = getDealershipDisplayId(userData);
    const fallbackDealershipNameMap = await fetchDealershipNameMap(fallbackDealershipId ? [fallbackDealershipId] : []);
    const emptySummary = await buildManagerDashboardSummary({
      currentUserId,
      monitorCandidates: [],
      averageCandidates: [],
      roleProfile,
      focusTraitOverride: focusTrait,
      recentLogs,
      dealershipId: '',
      dealershipName: resolveDealershipNameForUser(userData, fallbackDealershipNameMap, 'Current dealership'),
      scopeLabel: 'Current store',
    });

    return {
      ...emptySummary,
      mode: 'single-store',
      aggregate: emptySummary,
      stores: [emptySummary],
      storeCount: 1,
      scopeLabel: emptySummary.scopeLabel || 'Current scope',
    };
  }

  const userDocs = await fetchUsersByDealershipScope({
    dealershipIds,
    selectFields: [
      'avatarUrl',
      'name',
      'email',
      'loginEmail',
      'role',
      'roleLabel',
      'roleType',
      'roleScope',
      'visibilityScope',
      'xp',
      'stats',
      'freshUpMeter',
      'freshUpAvailable',
      'lessonCategory',
      'lastActiveAt',
      'lastLessonAt',
      'lastLesson',
      'lastLessonCategory',
      'recentSession',
      'recentSessions',
      'updatedAt',
      'dealershipId',
      'selfDeclaredDealershipId',
      'dealershipIds',
      'dealershipName',
    ],
  });
  const dealershipNameMap = await fetchDealershipNameMap(dealershipIds);
  const excludedFromTeamView = new Set(['Developer', 'Admin']);
  const allCandidates = (userDocs || [])
    .map((doc) => ({
      id: doc.id,
      data: (() => {
        const data = doc.data() || {};
        const displayDealershipId = getDealershipDisplayId(data, dealershipIds);
        return {
          ...data,
          dealershipId: String(data.dealershipId || displayDealershipId || '').trim(),
          dealershipName: resolveDealershipNameForUser(data, dealershipNameMap, '', dealershipIds),
        };
      })(),
    }))
    .filter(({ id, data }) => {
      const role = normalizeRoleLabel(data.role);
      return id !== currentUserId
        && !excludedFromTeamView.has(role)
        && String(data.name || '').trim()
        && candidateMatchesDealership(data, dealershipScopeIds);
    })
    .sort((left, right) => Number(right.data.xp || 0) - Number(left.data.xp || 0))
    ;

  const aggregateSummary = await buildManagerDashboardSummary({
    currentUserId,
    monitorCandidates: allCandidates,
    averageCandidates: allCandidates,
    roleProfile,
    focusTraitOverride: focusTrait,
    recentLogs,
    dealershipId: dealershipIds.length > 1 ? 'all' : (dealershipIds[0] || ''),
    dealershipName: dealershipIds.length > 1
      ? 'All Stores'
      : resolveDealershipNameForUser(userData, dealershipNameMap, dealershipIds[0] || 'Current dealership', dealershipIds),
    scopeLabel: dealershipIds.length > 1 ? 'All stores' : 'Current store',
  });

  const shouldUseMultiStore = ['Owner', 'General Manager'].includes(roleProfile.roleLabel) && dealershipIds.length > 1;
  const storeSummaries = [];

  if (shouldUseMultiStore) {
    for (let index = 0; index < dealershipIds.length; index += 1) {
      const dealershipId = dealershipIds[index];
      const dealershipName = dealershipNameMap.get(dealershipId) || `Store ${index + 1}`;
      const storeCandidates = allCandidates.filter(({ data }) => candidateMatchesDealership(data, new Set([dealershipId])));
      const storeSummary = await buildManagerDashboardSummary({
        currentUserId,
        monitorCandidates: storeCandidates,
        averageCandidates: storeCandidates,
        roleProfile,
        dealershipId,
        dealershipName,
        scopeLabel: dealershipName,
      });
      storeSummaries.push(storeSummary);
    }
  } else {
    storeSummaries.push(aggregateSummary);
  }

  return {
    ...aggregateSummary,
    mode: shouldUseMultiStore ? 'multi-store' : 'single-store',
    aggregate: aggregateSummary,
    stores: storeSummaries,
    storeCount: shouldUseMultiStore ? storeSummaries.length : 1,
    scopeLabel: shouldUseMultiStore ? 'All stores' : aggregateSummary.scopeLabel || 'Current scope',
  };
}

async function buildDeveloperDashboardData({ currentUserId = '', userData = {}, roleProfile = null, dealershipId = '' } = {}) {
  if (!firebaseDb) return null;

  const cacheKey = getDeveloperDashboardCacheKey({
    currentUserId,
    roleProfile,
    mockMode: userData?.mockMode,
    mockRoleOverride: userData?.mockRoleOverride,
    dealershipId,
  });
  const cachedDashboard = getDeveloperDashboardCache(cacheKey);
  if (cachedDashboard) {
    return cachedDashboard;
  }

  const users = [];
  const requestedDealershipId = String(dealershipId || '').trim();
  const userDocs = await fetchUsersByDealershipScope({
    dealershipIds: requestedDealershipId ? [requestedDealershipId] : [],
    allowAll: !requestedDealershipId,
    selectFields: [
      'avatarUrl',
      'name',
      'email',
      'loginEmail',
      'role',
      'roleLabel',
      'roleType',
      'roleScope',
      'visibilityScope',
      'xp',
      'stats',
      'freshUpMeter',
      'freshUpAvailable',
      'lessonCategory',
      'lastActiveAt',
      'lastLessonAt',
      'lastLesson',
      'lastLessonCategory',
      'recentSession',
      'recentSessions',
      'updatedAt',
      'dealershipId',
      'selfDeclaredDealershipId',
      'dealershipIds',
      'dealershipName',
      'dealershipEnrollmentCode',
      'accountStatus',
      'active',
    ],
    limit: 500,
  });

  for (const doc of userDocs) {
    const data = doc.data() || {};
    const storedRecentSessions = normalizeStoredRecentSessions(data.recentSessions, data.recentSession);
    const recentLog = storedRecentSessions[0] || null;
    const stats = normalizeStats(data.stats);
    const averageSkill = scoreFromStats(stats);
    const momentumScore = Math.max(0, Math.min(100, Math.round(Math.max(averageSkill, Number(data.freshUpMeter || 0) / 1.25))));
    const recentTimestamps = storedRecentSessions
      .map((session) => session.timestamp)
      .filter(Boolean);
    const lastActive = data.lastActiveAt || data.lastLessonAt || data.updatedAt || recentLog?.timestamp || null;
    users.push({
      id: doc.id,
      avatarUrl: String(data.avatarUrl || ''),
      name: String(data.name || 'Unknown User'),
      email: String(data.email || data.loginEmail || ''),
      role: normalizeRoleLabel(data.role),
      roleType: resolveAisRoleType(data.role),
      roleScope: getEnrollmentScopeLabel(getMaxEnrollmentScopeForInviter(data.role)),
      dealershipId: String(data.dealershipId || data.selfDeclaredDealershipId || '').trim(),
      selfDeclaredDealershipId: String(data.selfDeclaredDealershipId || '').trim(),
      dealershipIds: Array.isArray(data.dealershipIds) ? data.dealershipIds.map((value) => String(value || '').trim()).filter(Boolean) : [],
      dealershipName: String(data.dealershipName || data.storeName || data.companyName || '').trim(),
      dealershipEnrollmentCode: String(data.dealershipEnrollmentCode || data.dealerCode || data.inviteCode || data.accessCode || '').trim(),
      accountStatus: String(data.accountStatus || '').trim(),
      active: data.active !== false,
      xp: Number(data.xp || 0),
      level: calculateLevel(Number(data.xp || 0)),
      streak: calculateStreak(recentLog ? [recentLog.timestamp] : []),
      momentumScore,
      freshUpMeter: clampScore(data.freshUpMeter || 0),
      freshUpAvailable: data.freshUpAvailable === true,
      lessonCategory: String(data.lessonCategory || recentLog?.lessonCategory || ''),
      lastActive: formatRelativeTime(lastActive),
      lastLesson: String(data.lastLesson || recentLog?.title || recentLog?.lessonTitle || data.lastLessonCategory || '').trim(),
      stats,
      recentSession: recentLog ? {
        title: recentLog.title || recentLog.lessonTitle || 'Session',
        timestamp: recentLog.timestamp,
        score: Number(recentLog.score || recentLog.xpGained || 0),
      } : null,
      recentSessions: storedRecentSessions,
      streak: calculateStreak(recentTimestamps),
    });
  }

  const totalUsers = users.length;
  const avgXp = totalUsers
    ? Math.round(users.reduce((sum, item) => sum + Number(item.xp || 0), 0) / totalUsers)
    : 0;
  const avgMomentum = totalUsers
    ? Math.round(users.reduce((sum, item) => sum + Number(item.momentumScore || 0), 0) / totalUsers)
    : 0;
  const activeToday = users.filter((item) => {
    const label = String(item.lastActive || '').toLowerCase();
    return label === 'just now' || label.endsWith('m ago') || label.endsWith('h ago');
  }).length;
  const roleCounts = users.reduce((acc, item) => {
    const role = item.role || 'Unknown';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
  const dealershipOverview = await buildDealershipAdminOverview();
  const overviewDealershipNameMap = new Map(
    Array.isArray(dealershipOverview?.dealerships)
      ? dealershipOverview.dealerships
          .map((dealership) => [
            String(dealership.dealershipId || '').trim(),
            String(dealership.name || dealership.dealershipName || dealership.dealer_name || dealership.storeName || '').trim(),
          ])
          .filter(([dealershipId]) => Boolean(dealershipId))
      : []
  );
  const userDealershipIds = users
    .flatMap((user) => [
      user.dealershipId,
      user.selfDeclaredDealershipId,
      ...(Array.isArray(user.dealershipIds) ? user.dealershipIds : []),
    ])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const firestoreDealershipNameMap = await fetchDealershipNameMap(userDealershipIds);
  const dealershipNameMap = new Map([
    ...firestoreDealershipNameMap.entries(),
    ...overviewDealershipNameMap.entries(),
  ]);
  const usersWithDealershipNames = users.map((user) => {
    const resolvedDealershipId = getDealershipDisplayId(user);
    const dealershipName = resolveDealershipNameForUser(user, dealershipNameMap, 'Current dealership');
    return {
      ...user,
      dealershipId: resolvedDealershipId || user.dealershipId || '',
      dealershipName,
      active: user.active !== false,
      accountStatus: String(user.accountStatus || (user.active === false ? 'inactive' : 'active')).trim() || (user.active === false ? 'inactive' : 'active'),
    };
  });

  const sortedUsers = usersWithDealershipNames
    .slice()
    .sort((left, right) => Number(right.xp || 0) - Number(left.xp || 0));

  const dashboard = {
    generatedAt: new Date().toISOString(),
    dealershipId: requestedDealershipId || null,
    summary: {
      totalUsers: usersWithDealershipNames.length,
      avgXp: usersWithDealershipNames.length
        ? Math.round(usersWithDealershipNames.reduce((sum, item) => sum + Number(item.xp || 0), 0) / usersWithDealershipNames.length)
        : 0,
      avgMomentum: usersWithDealershipNames.length
        ? Math.round(usersWithDealershipNames.reduce((sum, item) => sum + Number(item.momentumScore || 0), 0) / usersWithDealershipNames.length)
        : 0,
      activeToday: usersWithDealershipNames.filter((item) => {
        const label = String(item.lastActive || '').toLowerCase();
        return label === 'just now' || label.endsWith('m ago') || label.endsWith('h ago');
      }).length,
      roleCounts: usersWithDealershipNames.reduce((acc, item) => {
        const role = item.role || 'Unknown';
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      }, {}),
    },
    dealerships: Array.isArray(dealershipOverview?.dealerships) ? dealershipOverview.dealerships : [],
    dealershipSummary: dealershipOverview?.summary || {
      totalDealerships: 0,
      activeDealerships: 0,
      totalUsers: 0,
    },
    users: sortedUsers,
    self: {
      currentUserId,
      currentRole: roleProfile?.roleLabel || normalizeRoleLabel(userData.role),
    },
  };
  setDeveloperDashboardCache(cacheKey, dashboard);
  return dashboard;
}

async function findUserDocByIdentifier(identifier) {
  if (!firebaseDb) return null;
  const normalized = String(identifier || '').trim();
  if (!normalized) return null;

  const directSnap = await firebaseDb.collection('users').doc(normalized).get().catch(() => null);
  if (directSnap?.exists) return directSnap;

  const normalizedEmail = normalizeEmail(normalized);
  const emailFields = ['email', 'loginEmail', 'emailLower'];
  for (const field of emailFields) {
    const querySnap = await firebaseDb.collection('users').where(field, '==', normalizedEmail).limit(1).get().catch(() => null);
    if (querySnap && !querySnap.empty) return querySnap.docs[0];
  }

  const rawFields = ['staffId', 'employeeId', 'employeeNumber', 'userId'];
  for (const field of rawFields) {
    const querySnap = await firebaseDb.collection('users').where(field, '==', normalized).limit(1).get().catch(() => null);
    if (querySnap && !querySnap.empty) return querySnap.docs[0];
  }

  const usersSnap = await firebaseDb.collection('users').get().catch(() => null);
  const match = (usersSnap?.docs || []).find((doc) => {
    const data = doc.data() || {};
    return normalizeEmail(data.email) === normalizedEmail
      || normalizeEmail(data.loginEmail) === normalizedEmail
      || normalizeLookupValue(data.staffId) === normalized
      || normalizeLookupValue(data.employeeId) === normalized
      || normalizeLookupValue(data.employeeNumber) === normalized
      || normalizeLookupValue(data.userId) === normalized;
  });
  return match || null;
}

function matchesLoginCode(userData, code) {
  const provided = String(code || '').trim();
  if (!provided) return false;
  const enrollmentCodes = new Set([
    userData.dealershipEnrollmentCode,
    userData.dealerCode,
    userData.inviteCode,
  ].map((value) => normalizeEnrollmentCode(value)).filter(Boolean));
  const candidates = [
    userData.loginCode,
    userData.accessCode,
    userData.pin,
    userData.password,
    userData.loginPassword,
    userData.passcode,
    userData.authCode,
    userData.loginPasscode,
    userData.loginPin,
  ]
    .map((value) => String(value || '').trim())
    .filter((value) => value && !enrollmentCodes.has(normalizeEnrollmentCode(value)));
  return candidates.includes(provided);
}

async function verifyFirebaseEmailPassword(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || '').trim();
  if (!normalizedEmail || !normalizedPassword || !FIREBASE_WEB_API_KEY || typeof fetch !== 'function') {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        password: normalizedPassword,
        returnSecureToken: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        reason: String(payload?.error?.message || response.status || 'invalid').trim(),
      };
    }
    return {
      ok: true,
      localId: String(payload.localId || '').trim(),
      email: String(payload.email || normalizedEmail).trim(),
    };
  } catch (error) {
    console.warn('[auth] Firebase password verification failed', error);
    return { ok: false, reason: 'network_error' };
  }
}

function candidatePerformanceScore(member, candidates) {
  const candidate = candidates.find((item) => item.id === member.id);
  if (!candidate) return 0;
  const stats = normalizeStats(candidate.data.stats);
  return scoreFromStats(stats);
}

function getUserDealershipScopeIds(userData) {
  const resolved = resolveUserDealershipData(userData);
  const primaryId = String(resolved.dealershipId || '').trim();
  return primaryId ? new Set([primaryId]) : null;
}

function candidateMatchesDealership(candidateData, dealershipScopeIds) {
  if (!dealershipScopeIds || dealershipScopeIds.size === 0) return true;
  const primaryId = String(candidateData?.dealershipId || '').trim();
  if (primaryId) return dealershipScopeIds.has(primaryId);

  const selfDeclaredId = String(candidateData?.selfDeclaredDealershipId || '').trim();
  if (selfDeclaredId) return dealershipScopeIds.has(selfDeclaredId);

  const legacyIds = Array.isArray(candidateData?.dealershipIds)
    ? candidateData.dealershipIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return legacyIds.some((dealershipId) => dealershipScopeIds.has(dealershipId));
}

async function fetchDealershipNameMap(dealershipIds) {
  const dealershipNameMap = new Map();
  if (!firebaseDb || !Array.isArray(dealershipIds) || dealershipIds.length === 0) {
    return dealershipNameMap;
  }

  const uniqueDealershipIds = Array.from(new Set(dealershipIds.map((value) => String(value || '').trim()).filter(Boolean)));
  await Promise.all(uniqueDealershipIds.map(async (dealershipId) => {
    const [dealershipSnap, dealerAccountSnap] = await Promise.all([
      firebaseDb.collection('dealerships').doc(dealershipId).get().catch(() => null),
      firebaseDb.collection('dealer_accounts').doc(dealershipId).get().catch(() => null),
    ]);

    const dealershipData = dealershipSnap?.data() || {};
    const dealerAccountData = dealerAccountSnap?.data() || {};
    const dealershipName = String(
      dealershipData.name
      || dealershipData.dealer_name
      || dealershipData.storeName
      || dealerAccountData.dealer_name
      || dealerAccountData.storeName
      || dealershipId
    ).trim();

    dealershipNameMap.set(dealershipId, dealershipName || dealershipId);
  }));

  return dealershipNameMap;
}

function buildAverageStatsLike(averageScores) {
  if (!averageScores) return null;
  return normalizeStats({
    empathy: { score: averageScores.empathy },
    listening: { score: averageScores.listening },
    trust: { score: averageScores.trust },
    followUp: { score: averageScores.followUp },
    closing: { score: averageScores.closing },
    relationship: { score: averageScores.relationship },
  });
}

async function buildManagerDashboardSummary({
  currentUserId,
  monitorCandidates = [],
  averageCandidates = monitorCandidates,
  roleProfile,
  focusTraitOverride = null,
  recentLogs = [],
  dealershipId = '',
  dealershipName = '',
  scopeLabel = '',
}) {
  const topMonitorCandidates = Array.isArray(monitorCandidates) ? monitorCandidates : [];
  const teamMonitor = [];
  const teamMembers = [];
  const momentumLogs = [];

  for (const candidate of topMonitorCandidates) {
    const stats = normalizeStats(candidate.data.stats);
    const candidateLogsSnap = await firebaseDb.collection('users').doc(candidate.id).collection('lessonLogs').orderBy('timestamp', 'desc').limit(3).get().catch(() => ({ empty: true, docs: [] }));
    const candidateLogs = candidateLogsSnap?.docs?.map(normalizeSessionLog) || [];
    const latestTimestamp = candidateLogs[0]?.timestamp || null;
    teamMonitor.push({
      id: candidate.id,
      name: String(candidate.data.name || 'Consultant'),
      role: normalizeRoleLabel(candidate.data.role),
      level: calculateLevel(Number(candidate.data.xp || 0)).level,
      topSkill: TRAIT_LABELS[strongestTrait(stats)] || strongestTrait(stats),
      watchArea: TRAIT_LABELS[weakestTrait(stats)] || weakestTrait(stats),
      lastActive: formatRelativeTime(latestTimestamp),
      dealershipId: String(candidate.data.dealershipId || candidate.data.selfDeclaredDealershipId || '').trim(),
      dealershipName: String(candidate.data.dealershipName || ''),
    });
    teamMembers.push({
      id: candidate.id,
      userId: candidate.id,
      name: String(candidate.data.name || 'Consultant'),
      role: normalizeRoleLabel(candidate.data.role),
      roleLabel: normalizeRoleLabel(candidate.data.role),
      roleType: resolveAisRoleType(candidate.data.role),
      avatarUrl: String(candidate.data.avatarUrl || ''),
      dealershipId: String(candidate.data.dealershipId || candidate.data.selfDeclaredDealershipId || '').trim(),
      selfDeclaredDealershipId: String(candidate.data.selfDeclaredDealershipId || '').trim(),
      dealershipIds: Array.isArray(candidate.data.dealershipIds) ? candidate.data.dealershipIds.map((value) => String(value || '').trim()).filter(Boolean) : [],
      dealershipName: String(candidate.data.dealershipName || ''),
      xp: Number(candidate.data.xp || 0),
      level: calculateLevel(Number(candidate.data.xp || 0)),
      streak: calculateStreak(candidateLogs.map((log) => log.timestamp)),
      momentumScore: Math.round(scoreFromStats(stats)),
      focusTrait: weakestTrait(stats),
      strongTrait: strongestTrait(stats),
      freshUpMeter: clampScore(candidate.data.freshUpMeter || 0),
      freshUpAvailable: candidate.data.freshUpAvailable === true,
      momentumSeries: buildMomentumSeriesFromLogs(candidateLogs, 1),
      stats,
      recentSessions: candidateLogs.slice(0, 3).map((log) => ({
        title: log.title || log.lessonTitle || 'Session',
        timestamp: log.timestamp,
        duration: Number(log.duration || 0),
        score: Number(log.score || log.xpGained || 0),
      })),
      topSkill: TRAIT_LABELS[strongestTrait(stats)] || strongestTrait(stats),
      watchArea: TRAIT_LABELS[weakestTrait(stats)] || weakestTrait(stats),
      lastActive: formatRelativeTime(latestTimestamp),
    });
    momentumLogs.push(...candidateLogs);
  }

  const departmentAverageScores = averageTraitScoresFromCandidates(averageCandidates);
  const departmentMomentum = departmentAverageScores
    ? Math.round((
      departmentAverageScores.empathy +
      departmentAverageScores.listening +
      departmentAverageScores.trust +
      departmentAverageScores.followUp +
      departmentAverageScores.closing +
      departmentAverageScores.relationship
    ) / 6)
    : 0;

  const averageStats = buildAverageStatsLike(departmentAverageScores);
  const focusTrait = focusTraitOverride || (averageStats ? weakestTrait(averageStats) : 'trust');
  const strongest = averageStats ? strongestTrait(averageStats) : 'trust';
  const storePerformance = teamMonitor.length
    ? Math.round(teamMonitor.reduce((sum, member) => sum + Math.max(0, Number(candidatePerformanceScore(member, averageCandidates)) || 0), 0) / teamMonitor.length)
    : departmentMomentum;
  const focusScore = averageStats ? Number(averageStats?.[focusTrait]?.score ?? 60) : 60;
  const weaknessDelta = Math.max(0, 60 - Math.round(focusScore));
  const trendSourceLogs = recentLogs.length ? recentLogs : momentumLogs;
  const trendDelta = trendSourceLogs.length >= 2
    ? Math.max(-9, Math.min(9, Number(trendSourceLogs[0]?.score || 0) - Number(trendSourceLogs[1]?.score || 0)))
    : Math.max(-9, Math.min(9, Math.round(departmentMomentum - storePerformance) / 10));

  return {
    dealershipId,
    dealershipName,
    scopeLabel: scopeLabel || dealershipName || 'Current scope',
    storePerformance: storePerformance || departmentMomentum,
    trendLabel: `${trendDelta >= 0 ? '+' : ''}${trendDelta}% Trend`,
    biggestOpportunity: {
      title: `${TRAIT_LABELS[focusTrait] || focusTrait} scores are down ${weaknessDelta || 1}% this week.`,
      body: `Deploy a coaching plan that sharpens ${(TRAIT_LABELS[focusTrait] || focusTrait).toLowerCase()} across the team first.`,
    },
    todayFocus: buildManagerTodayFocus(roleProfile, focusTrait, `${dealershipId || currentUserId || 'store'}:today-focus`),
    autoForgeFocus: `This week's focus: ${TRAIT_LABELS[focusTrait] || focusTrait} across team`,
    departmentAverageScores,
    departmentMomentum,
    momentumSeries: momentumLogs.length ? buildMomentumSeriesFromLogs(momentumLogs, averageCandidates.length) : buildMomentumSeriesFromLogs([], averageCandidates.length),
    teamMonitor,
    teamMembers,
    candidateCount: averageCandidates.length,
    activeUsers: teamMembers.filter((member) => {
      const label = String(member.lastActive || '').toLowerCase();
      return label === 'just now' || label.endsWith('m ago') || label.endsWith('h ago');
    }).length,
    strongestTrait: strongest,
    focusTrait,
  };
}

function averageTraitScoresFromCandidates(candidates) {
  const statBuckets = candidates.map(({ data }) => normalizeStats(data.stats));
  if (!statBuckets.length) return null;

  return {
    empathy: Math.round(statBuckets.reduce((sum, stats) => sum + Number(stats.empathy?.score || 0), 0) / statBuckets.length),
    listening: Math.round(statBuckets.reduce((sum, stats) => sum + Number(stats.listening?.score || 0), 0) / statBuckets.length),
    trust: Math.round(statBuckets.reduce((sum, stats) => sum + Number(stats.trust?.score || 0), 0) / statBuckets.length),
    followUp: Math.round(statBuckets.reduce((sum, stats) => sum + Number(stats.followUp?.score || 0), 0) / statBuckets.length),
    closing: Math.round(statBuckets.reduce((sum, stats) => sum + Number(stats.closing?.score || 0), 0) / statBuckets.length),
    relationship: Math.round(statBuckets.reduce((sum, stats) => sum + Number(stats.relationship?.score || 0), 0) / statBuckets.length),
  };
}

function averageLogScore(log) {
  const ratings = log?.ratings || {};
  const values = [
    ratings.empathy,
    ratings.listening,
    ratings.trust,
    ratings.followUp,
    ratings.closing,
    ratings.relationship,
  ].map((value) => clampScore(value));
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildMomentumSeriesFromLogs(logs, candidateCount = 0) {
  const sortedLogs = [...logs]
    .filter((log) => log && log.timestamp)
    .sort((left, right) => {
      const leftTime = toDate(left.timestamp)?.getTime() || 0;
      const rightTime = toDate(right.timestamp)?.getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, 6)
    .reverse();

  if (!sortedLogs.length) return null;

  return sortedLogs.map((log, index) => {
    const value = clampScore(averageLogScore(log));
    return {
      label: `P${index + 1}`,
      value,
      trend: log.scoreDelta || null,
      activitySource: log.activitySource || 'core',
      candidateCount,
      timestamp: toIso(log.timestamp) || null,
    };
  });
}

function isTruthyFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function fetchUserBundle(userId, roleOverride = null, mockMode = false, mockRoleOverride = null) {
  if (isTruthyFlag(mockMode)) {
    return buildMockUserBundle(mockRoleOverride || roleOverride);
  }

  if (!firebaseDb) {
    return null;
  }

  if (!userId) return null;

  let userDoc = null;
  const snap = await firebaseDb.collection('users').doc(userId).get();
  if (snap.exists) {
    userDoc = snap;
  }

  const isTemporaryDeveloperLogin = normalizeEmail(userId) === normalizeEmail('andrew@autoknerd.com');
  if (!userDoc && isTemporaryDeveloperLogin) {
    return buildTemporaryDeveloperBundle({
      userId: normalizeEmail(userId) || 'developer-session',
      mockMode,
      mockRoleOverride,
    });
  }

  if (!userDoc) return null;

  const userData = userDoc.data() || {};
  const resolvedDealershipData = resolveUserDealershipData(userData);
  const nextDealershipId = resolvedDealershipData.dealershipId || '';
  const nextDealershipIds = resolvedDealershipData.dealershipIds;
  let resolvedDealershipName = String(userData.dealershipName || userData.storeName || userData.companyName || '').trim();
  if (!resolvedDealershipName && nextDealershipId) {
    const dealershipSnap = await firebaseDb.collection('dealerships').doc(nextDealershipId).get().catch(() => null);
    resolvedDealershipName = String(dealershipSnap?.data()?.name || dealershipSnap?.data()?.dealer_name || dealershipSnap?.data()?.storeName || '').trim();
  }
  const shouldBackfillDealership = Boolean(nextDealershipId)
    && (
      String(userData.dealershipId || '').trim() !== nextDealershipId
      || !Array.isArray(userData.dealershipIds)
      || !userData.dealershipIds.includes(nextDealershipId)
    );
  if (shouldBackfillDealership) {
    try {
      await firebaseDb.collection('users').doc(userDoc.id).set({
        dealershipId: nextDealershipId,
        selfDeclaredDealershipId: nextDealershipId,
        dealershipIds: Array.from(new Set([nextDealershipId, ...nextDealershipIds])),
      }, { merge: true });
    } catch (error) {
      console.warn('[bundle] unable to backfill dealership fields', error.message);
    }
  }
  const badgesSnap = await firebaseDb.collection('users').doc(userDoc.id).collection('earnedBadges').orderBy('timestamp', 'desc').limit(12).get().catch(() => ({ empty: true, docs: [] }));

  const badges = badgesSnap.docs ? badgesSnap.docs.map((doc) => ({
    id: doc.id,
    timestamp: toIso(doc.data()?.timestamp) || null,
  })) : [];

  const stats = normalizeStats(userData.stats);
  const xp = Number(userData.xp || 0);
  const level = calculateLevel(xp);
  const overrideRole = normalizeDeveloperRoleOverride(roleOverride);
  const effectiveRole = overrideRole || userData.role;
  const roleProfile = getRoleProfile(effectiveRole);
  const roleType = roleProfile.roleType;
  const storedRecentSessions = normalizeStoredRecentSessions(userData.recentSessions, userData.recentSession);
  const shouldUseStoredRecentSessions = storedRecentSessions.length > 0 || roleProfile.roleLabel === 'Developer';
  const recentLogs = shouldUseStoredRecentSessions
    ? storedRecentSessions.map((session) => ({
        activitySource: String(session.activitySource || 'core'),
        timestamp: session.timestamp || null,
        title: session.title || '',
        lessonTitle: session.title || '',
        lessonCategory: session.lessonCategory || '',
        score: session.score || 0,
        xpGained: session.score || 0,
      }))
    : [];

  let recentLogsToUse = recentLogs;
  if (!recentLogsToUse.length) {
    const logsSnap = await firebaseDb.collection('users').doc(userDoc.id).collection('lessonLogs').orderBy('timestamp', 'desc').limit(12).get();
    recentLogsToUse = logsSnap.docs.map(normalizeSessionLog);
  }

  const streak = calculateStreak(recentLogsToUse.map((log) => log.timestamp));
  const focusTrait = weakestTrait(stats);
  const strongTrait = strongestTrait(stats);
  const averageSkill = scoreFromStats(stats);
  const freshUpMeter = clampScore(userData.freshUpMeter || 0);
  const freshUpAvailable = userData.freshUpAvailable === true;
  const momentumScore = Math.max(0, Math.min(100, Math.round(Math.max(averageSkill, freshUpMeter / 1.25))));
  const lessonCategory = pickRoleLessonCategory(roleProfile.roleLabel || effectiveRole, roleType, focusTrait, `${userDoc.id}:${dateKey(new Date())}`);
  const lessonProfile = getLessonCategoryProfile(lessonCategory);
  const lessonLibrary = buildLessonLibrary(roleProfile.roleLabel || effectiveRole, roleType, focusTrait, lessonCategory);
  const focus = buildMissionFocus(focusTrait, roleProfile.roleLabel || 'Sales Consultant', lessonCategory);
  const freshUpExperience = getFreshUpExperience(roleProfile.roleLabel || effectiveRole, roleType);
  const insightFallback = momentumScore >= 85
    ? 'You are building strong momentum. Keep the same pace and protect the trust you already built.'
    : focusTrait === 'trust'
      ? 'You are making steady progress. Slow the opening down today and let trust lead the way.'
      : `You are building in the right direction. Keep your eye on ${TRAIT_LABELS[focusTrait] || focusTrait}; that is where the next jump lives.`;
  const aiInsightPromise = buildInsightCopy({
    userName: userData.name || 'Consultant',
    role: roleProfile.roleLabel || 'Sales Consultant',
    focusTrait,
    strongTrait,
    streak,
    momentumScore,
  }).catch(() => insightFallback);
  const insight = await withTimeout(aiInsightPromise, 1200, insightFallback);
  const managerDashboard = isManagerDashboardRole(roleProfile.roleLabel)
    ? await buildManagerDashboardData({
        currentUserId: userDoc.id,
        userData: {
          ...userData,
          dealershipId: nextDealershipId || userData.dealershipId || '',
          dealershipIds: Array.from(new Set([...(nextDealershipIds || []), String(userData.dealershipId || '').trim()].filter(Boolean))),
          dealershipName: resolvedDealershipName,
          momentumScore,
        },
        roleProfile,
        focusTrait,
        recentLogs: recentLogsToUse,
      })
    : null;
  const developerDashboard = isPrivilegedDealershipRole(roleProfile.roleLabel)
    ? await buildDeveloperDashboardData({
        currentUserId: userDoc.id,
        userData: {
          ...userData,
          dealershipId: nextDealershipId || userData.dealershipId || '',
          dealershipIds: Array.from(new Set([...(nextDealershipIds || []), String(userData.dealershipId || '').trim()].filter(Boolean))),
          dealershipName: resolvedDealershipName,
          momentumScore,
        },
        roleProfile,
        dealershipId: nextDealershipId || userData.dealershipId || '',
      })
    : null;

  return {
    user: {
      userId: userDoc.id,
      ...userData,
      sourceRole: userData.role,
      role: effectiveRole,
      roleLabel: roleProfile.roleLabel,
      stats,
      xp,
      level,
      streak,
      momentumScore,
      dealershipId: nextDealershipId || userData.dealershipId || '',
      dealershipIds: Array.from(new Set([...(nextDealershipIds || []), String(userData.dealershipId || '').trim()].filter(Boolean))),
      dealershipName: resolvedDealershipName,
      focusTrait,
      strongTrait,
      freshUpMeter,
      freshUpAvailable,
      freshUpCoreSessionsSinceLast: Math.max(0, Number(userData.freshUpCoreSessionsSinceLast ?? 0)),
      roleType,
      roleScope: roleProfile.maxEnrollmentScope,
      visibilityScope: roleProfile.visibilityScope,
      lessonCategory,
      roleOverride: overrideRole,
    },
    recentSessions: recentLogsToUse.slice(0, 3),
    badges,
    focus,
    insight,
    roleProfile,
    freshUpExperience,
    freshUpSystemLabel: freshUpExperience.systemLabel,
    freshUpBossLabel: freshUpExperience.bossLabel,
    lessonCategory,
    lessonProfile,
    lessonLibrary,
    managerDashboard,
    developerDashboard,
  };
}

async function buildInsightCopy({ userName, role, focusTrait, strongTrait, streak, momentumScore }) {
  const prompt = [
    'You are Sprocket AI, a dealership coaching assistant.',
    `Rewrite the coaching insight into one short, direct, encouraging sentence.`,
    `User: ${userName}. Role: ${role}.`,
    `Weakest skill: ${TRAIT_LABELS[focusTrait] || focusTrait}. Strongest skill: ${TRAIT_LABELS[strongTrait] || strongTrait}.`,
    `Streak: ${streak}. Momentum score: ${momentumScore}.`,
    'Rules:',
    '- One sentence only.',
    '- No markdown.',
    '- No phrase like "pattern recognized".',
    '- Sound like a real coach speaking directly to the consultant.',
    '- Be strengths-based and supportive, even when pointing to a growth area.',
    '- Avoid harsh, discouraging, or negative phrasing.',
    '- Keep it under 18 words.',
  ].join('\n');

  const fallback = momentumScore >= 85
    ? 'You are building strong momentum. Keep the same pace and protect the trust you already built.'
    : focusTrait === 'trust'
      ? 'You are making steady progress. Slow the opening down today and let trust lead the way.'
      : `You are building in the right direction. Keep your eye on ${TRAIT_LABELS[focusTrait] || focusTrait}; that is where the next jump lives.`;

  const text = await callGemini(prompt, fallback);
  return text.replace(/\s+/g, ' ').trim();
}

async function generateFreshUpStartSession(bundle) {
  const { user, focus, insight } = bundle;
  const roleProfile = bundle.roleProfile || getRoleProfile(user.role);
  const roleType = roleProfile.roleType;
  const roleTheme = getRoleTheme(roleType);
  const freshUpProgram = getFreshUpExperience(roleProfile.roleLabel || user.role, roleType);
  const sessionKey = `${user.userId || 'user'}:${dateKey(new Date())}:fresh-up`;
  const lessonCategory = bundle.lessonCategory || pickRoleLessonCategory(roleProfile.roleLabel || user.role, roleType, user.focusTrait, sessionKey);
  const lessonProfile = bundle.lessonProfile || getLessonCategoryProfile(lessonCategory);
  const level = calculateLevel(user.xp);
  const strongest = TRAIT_LABELS[user.strongTrait] || user.strongTrait;
  const weakest = TRAIT_LABELS[user.focusTrait] || user.focusTrait;
  const targetUserTurns = randomInt(5, 7);

  const prompt = [
    'You are Sprocket, AutoKnerd\'s dealership coaching assistant.',
    `Create a ${freshUpProgram.bossLabel} scenario for a ${roleProfile.roleLabel}.`,
    'This is a boss encounter in the game-like coaching experience, but it must still feel professional, realistic, and dealership-native.',
    `Current level: ${level.level}. XP: ${user.xp}. Streak: ${user.streak}. Momentum: ${user.momentumScore}.`,
    `Weakest skill: ${weakest}. Strongest skill: ${strongest}.`,
    `Role tone: ${roleTheme.tone}. Customer mindset: ${roleTheme.customerMindset}. Language: ${roleTheme.languageStyle}.`,
    `Fresh Up experience: ${freshUpProgram.systemLabel}.`,
    `Boss label: ${freshUpProgram.bossLabel}.`,
    `Scenario mode: ${freshUpProgram.audience === 'manager' ? 'manager coaching' : 'customer challenge'}.`,
    `Role interaction label: ${roleTheme.interactionLabel}.`,
    `Lesson category: ${freshUpProgram.bossLabel}.`,
    `Role lesson anchor: ${lessonCategory}.`,
    `Lesson objective: ${lessonProfile?.description || lessonProfile?.microFocus || 'Keep the session grounded in the role and customer need.'}.`,
    `Role concerns: ${(roleTheme.concerns || roleTheme.typicalConcerns || []).join(', ')}.`,
    `Role stages: ${(roleTheme.stages || []).join(' -> ')}.`,
    `Role scenario: ${roleTheme.customScenario}.`,
    `Today's focus: ${focus.title}. Micro focus: ${focus.microFocus}.`,
    `Sprocket insight: ${insight}.`,
    'Recommended session length: 5-7 user turns.',
    'Return JSON only with:',
    '{',
    '  "title": "short mission title",',
    '  "description": "one brief mission description",',
    '  "coachLine": "one short coaching line from Sprocket",',
    '  "customerOpening": "one natural customer opening line",',
    '  "focus": "Focus: ... -> ...",',
    `  "lessonCategory": "${freshUpProgram.bossLabel}",`,
    '  "lessonTitle": "short lesson title",',
    '  "trustLabel": "Good" | "Strong" | "Needs Work",',
    '  "targetUserTurns": 5-7,',
    '  "customerName": "short customer name",',
    '  "scenarioSummary": "one short scenario summary",',
    '  "customerConcern": "short concern label",',
    '  "choices": [',
    '    { "letter": "A", "text": "best response" },',
    '    { "letter": "B", "text": "decent response" },',
    '    { "letter": "C", "text": "off-target response" }',
    '  ]',
    '}',
    'Rules: Keep it short, practical, and human. The opening should feel like a live customer, not a quiz. No markdown.',
  ].join('\n');

  const fallback = buildFreshUpBossFallback({
    user,
    focus,
    insight,
    roleType,
    targetUserTurns,
    lessonCategory,
    lessonProfile,
  });
  const raw = await callGemini(prompt, JSON.stringify(fallback));
  const parsed = extractJson(raw);
  const mission = normalizeSessionStartOutput(parsed, fallback);
  return {
    ...mission,
    title: mission.title || fallback.title,
    lessonCategory: mission.lessonCategory || fallback.lessonCategory || freshUpProgram.bossLabel,
    lessonTitle: mission.lessonTitle || fallback.lessonTitle || lessonProfile?.title || lessonCategory,
    description: mission.description || fallback.description,
    coachLine: mission.coachLine || fallback.coachLine,
    customerOpening: mission.customerOpening || fallback.customerOpening,
    focus: mission.focus || fallback.focus,
    trustLabel: mission.trustLabel || fallback.trustLabel,
    targetUserTurns: clamp(Math.round(Number(mission.targetUserTurns || fallback.targetUserTurns || 6)), 5, 7),
    customerName: mission.customerName || fallback.customerName,
    scenarioSummary: mission.scenarioSummary || fallback.scenarioSummary,
    customerConcern: mission.customerConcern || fallback.customerConcern,
    choices: mission.choices || fallback.choices,
    activitySource: 'fresh-up',
    lessonId: 'fresh-up',
    freshUpSystemLabel: mission.freshUpSystemLabel || fallback.freshUpSystemLabel || freshUpProgram.systemLabel,
    freshUpBossLabel: mission.freshUpBossLabel || fallback.freshUpBossLabel || freshUpProgram.bossLabel,
    freshUpAudience: mission.freshUpAudience || fallback.freshUpAudience || freshUpProgram.audience,
    freshUpReadyCopy: mission.freshUpReadyCopy || fallback.freshUpReadyCopy || freshUpProgram.readyCopy,
    freshUpLockedCopy: mission.freshUpLockedCopy || fallback.freshUpLockedCopy || freshUpProgram.lockedCopy,
  };
}

async function generateStartSession(bundle, lessonCategoryOverride = null, options = {}) {
  if (options.freshUp === true) {
    return generateFreshUpStartSession(bundle);
  }

  const { user, focus, insight } = bundle;
  const roleProfile = bundle.roleProfile || getRoleProfile(user.role);
  const roleType = roleProfile.roleType;
  const roleTheme = getRoleTheme(roleType);
  const sessionKey = `${user.userId || 'user'}:${dateKey(new Date())}`;
  const lessonCategory = bundle.lessonCategory || lessonCategoryOverride || pickRoleLessonCategory(roleProfile.roleLabel || user.role, roleType, user.focusTrait, sessionKey);
  const lessonProfile = bundle.lessonProfile || getLessonCategoryProfile(lessonCategory);
  const level = calculateLevel(user.xp);
  const strongest = TRAIT_LABELS[user.strongTrait] || user.strongTrait;
  const weakest = TRAIT_LABELS[user.focusTrait] || user.focusTrait;
  const targetRange = getRoleExchangeTarget(roleType);
  const targetUserTurns = randomInt(targetRange.min, targetRange.max);

  const prompt = [
    'You are Sprocket, AutoKnerd\'s dealership coaching assistant.',
    `Create a realistic customer scenario for a ${roleProfile.roleLabel} that lasts ${targetUserTurns} user turns.`,
    `Current level: ${level.level}. XP: ${user.xp}. Streak: ${user.streak}. Momentum: ${user.momentumScore}.`,
    `Weakest skill: ${weakest}. Strongest skill: ${strongest}.`,
    `Role tone: ${roleTheme.tone}. Customer mindset: ${roleTheme.customerMindset}. Language: ${roleTheme.languageStyle}.`,
    `Role interaction label: ${roleTheme.interactionLabel}.`,
    `Lesson category: ${lessonCategory}.`,
    `Lesson objective: ${lessonProfile?.description || lessonProfile?.microFocus || 'Keep the session grounded in the role and customer need.'}.`,
    `Role concerns: ${(roleTheme.concerns || roleTheme.typicalConcerns || []).join(', ')}.`,
    `Role stages: ${(roleTheme.stages || []).join(' -> ')}.`,
    `Role scenario: ${roleTheme.customScenario}.`,
    `Today's focus: ${focus.title}. Micro focus: ${focus.microFocus}.`,
    `Sprocket insight: ${insight}.`,
    `Recommended session length: ${targetRange.min}-${targetRange.max} user turns.`,
    'Return JSON only with:',
    '{',
    '  "title": "short mission title",',
    '  "description": "one brief mission description",',
    '  "coachLine": "one short coaching line from Sprocket",',
    '  "customerOpening": "one natural customer opening line",',
    '  "focus": "Focus: ... -> ...",',
    '  "lessonCategory": "role-specific lesson category",',
    '  "lessonTitle": "short lesson title",',
    '  "trustLabel": "Good" | "Strong" | "Needs Work",',
    `  "targetUserTurns": ${targetRange.min}-${targetRange.max},`,
    '  "customerName": "short customer name",',
    '  "scenarioSummary": "one short scenario summary",',
    '  "customerConcern": "short concern label",',
    '  "choices": [',
    '    { "letter": "A", "text": "best response" },',
    '    { "letter": "B", "text": "decent response" },',
    '    { "letter": "C", "text": "off-target response" }',
    '  ]',
    '}',
    'Rules: Keep it short, practical, and human. The opening should feel like a live customer, not a quiz. No markdown.',
  ].join('\n');

  const fallback = buildStartFallback({
    user,
    focus,
    insight,
    roleType,
    targetUserTurns,
    lessonCategory,
    lessonProfile,
  });
  const raw = await callGemini(prompt, JSON.stringify(fallback));
  const parsed = extractJson(raw);
  return normalizeSessionStartOutput(parsed, fallback);
}

async function generateSessionTurn(bundle, session, payload) {
  const userMessage = String(payload.answer || payload.message || '').trim();
  const history = session.messages.map((message) => `${message.sender}: ${message.text}`).join('\n');
  const prompt = [
    'You are Sprocket, AutoKnerd\'s dealership customer scenario engine.',
    `Continue a live customer conversation for a ${bundle.roleProfile?.roleLabel || bundle.user.role}.`,
    `Scenario title: ${session.title}.`,
    `Scenario summary: ${session.scenarioSummary}.`,
    `Customer concern: ${session.customerConcern}.`,
    `Role tone: ${bundle.roleProfile?.roleTone || getRoleTheme(session.roleType || resolveAisRoleType(bundle.user.role)).tone}.`,
    `Role stages: ${(bundle.roleProfile?.stages || []).join(' -> ') || 'none'}.`,
    `Target user turns: ${session.targetUserTurns}.`,
    `Current user turns completed: ${session.currentUserTurns}.`,
    `Current trust label: ${session.trustLabel}.`,
    `Latest user response: ${userMessage || 'none'}.`,
    'Conversation history:',
    history || '(no history)',
    'Return JSON only with:',
    '{',
    '  "customerReply": "1-2 sentences as the customer",',
    '  "coachNote": "one short Sprocket coaching line",',
    '  "trustLabel": "Needs Work" | "Good" | "Strong",',
    '  "choices": [',
    '    { "letter": "A", "text": "best response" },',
    '    { "letter": "B", "text": "decent response" },',
    '    { "letter": "C", "text": "off-target response" }',
    '  ],',
    '  "ratings": {',
    '    "empathy": 0-100,',
    '    "listening": 0-100,',
    '    "trust": 0-100,',
    '    "followUp": 0-100,',
    '    "closing": 0-100,',
    '    "relationship": 0-100',
    '  }',
    '}',
    'Rules: keep the customer realistic, skeptical when needed, and tied to the scenario. Do not end the lesson yet unless the dialogue has clearly reached the final turn. No markdown.',
  ].join('\n');

  const fallback = buildTurnFallback({ session, userMessage });
  const raw = await callGemini(prompt, JSON.stringify(fallback));
  const parsed = extractJson(raw);
  return normalizeSessionTurnOutput(parsed, fallback);
}

async function generateSessionResult(bundle, session, payload) {
  const answerText = String(payload.answer || '').trim();
  const prompt = buildSessionResultPrompt({ bundle, session, userMessage: answerText });
  const fallback = buildResultFallback({ session });
  const raw = await callGemini(prompt, JSON.stringify(fallback));
  const parsed = extractJson(raw);
  return normalizeSessionResult(parsed, fallback);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function serveIndex(res) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function serializeActiveSession(session) {
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    title: session.title,
    dealershipId: session.dealershipId || null,
    dealershipIds: Array.isArray(session.dealershipIds) ? session.dealershipIds : [],
    dealershipName: session.dealershipName || null,
    lessonCategory: session.lessonCategory || null,
    lessonTitle: session.lessonTitle || null,
    freshUpSystemLabel: session.freshUpSystemLabel || null,
    freshUpBossLabel: session.freshUpBossLabel || null,
    freshUpAudience: session.freshUpAudience || null,
    freshUpReadyCopy: session.freshUpReadyCopy || null,
    freshUpLockedCopy: session.freshUpLockedCopy || null,
    activitySource: session.activitySource || 'core',
    lessonId: session.lessonId || session.lessonCategory || session.sessionId,
    description: session.description,
    coachLine: session.coachLine,
    customerName: session.customerName,
    customerOpening: session.customerOpening,
    focus: session.focus,
    trustLabel: session.trustLabel,
    trustScore: clampScore(session.runningRatings?.trust ?? session.trustScore ?? 0),
    targetUserTurns: session.targetUserTurns,
    currentUserTurns: session.currentUserTurns,
    progress: Math.round((Math.max(0, Number(session.currentUserTurns || 0)) / Math.max(1, Number(session.targetUserTurns || 1))) * 100),
    scenarioSummary: session.scenarioSummary,
    customerConcern: session.customerConcern,
    choices: Array.isArray(session.choices) ? session.choices : [],
    messages: Array.isArray(session.messages) ? session.messages : [],
    startedAt: session.startedAt || null,
  };
}

function buildSessionUserKeys(userLike) {
  const rawValues = [
    userLike?.userId,
    userLike?.id,
    userLike?.email,
    userLike?.loginEmail,
    userLike,
  ];
  return Array.from(new Set(
    rawValues
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .flatMap((value) => {
        const normalizedEmail = normalizeEmail(value);
        return normalizedEmail && normalizedEmail !== value
          ? [value, normalizedEmail]
          : [value];
      })
  ));
}

function getActiveSessionForUser(userLike) {
  const userKeys = buildSessionUserKeys(userLike);
  if (!userKeys.length) return null;
  const matches = Array.from(activeSessions.values())
    .filter((session) => {
      const sessionKeys = Array.isArray(session?.userLookupKeys) ? session.userLookupKeys : buildSessionUserKeys(session?.userId);
      return sessionKeys.some((key) => userKeys.includes(key));
    })
    .sort((a, b) => String(b?.startedAt || '').localeCompare(String(a?.startedAt || '')));
  return matches[0] || null;
}

function clearActiveSessionsForUser(userLike) {
  const userKeys = buildSessionUserKeys(userLike);
  if (!userKeys.length) return;
  activeSessions.forEach((session, sessionId) => {
    const sessionKeys = Array.isArray(session?.userLookupKeys) ? session.userLookupKeys : buildSessionUserKeys(session?.userId);
    if (sessionKeys.some((key) => userKeys.includes(key))) {
      activeSessions.delete(sessionId);
    }
  });
}

async function handleBootstrap(req, res, url) {
  const token = getRequestToken(req, url);
  const sessionUserId = getAuthSession(token)?.userId || '';
  const requestedUserId = String(url.searchParams.get('userId') || '').trim();
  const userId = requestedUserId || sessionUserId || undefined;
  const roleOverride = url.searchParams.get('roleOverride') || undefined;
  const mockRoleOverride = url.searchParams.get('mockRoleOverride') || undefined;
  const mockMode = url.searchParams.get('mockMode') || undefined;
  try {
    if (!userId && !isTruthyFlag(mockMode)) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }
    if (requestedUserId && requestedUserId !== sessionUserId && !isTruthyFlag(mockMode)) {
      if (!sessionUserId) {
        return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
      }
      const requesterDoc = await findUserDocByIdentifier(sessionUserId);
      const requesterData = requesterDoc?.data?.() || {};
      const requesterRole = normalizeRoleLabel(requesterData.roleLabel || requesterData.role);
      if (!isPrivilegedDealershipRole(requesterRole)) {
        return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
      }
    }
    const bundle = await withTimeout(
      fetchUserBundle(userId, roleOverride, mockMode, mockRoleOverride),
      8000,
      null,
    );
    if (!bundle) {
      return sendJson(res, 504, { ok: false, message: 'User data took too long to load. Please try again.' });
    }
    const activeSession = serializeActiveSession(getActiveSessionForUser(bundle.user));
    return sendJson(res, 200, { ok: true, ...bundle, activeSession });
  } catch (error) {
    console.error('[bootstrap] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to load user data.' });
  }
}

async function handleAuthSignIn(req, res) {
  try {
    const body = await readBody(req);
    const identifier = String(body.identifier || body.email || body.userId || '').trim();
    const code = String(
      body.code ||
      body.accessCode ||
      body.password ||
      body.loginCode ||
      body.passcode ||
      body.authCode ||
      ''
    ).trim();
    const isTemporaryDeveloperLogin = normalizeEmail(identifier) === normalizeEmail('andrew@autoknerd.com');
    const requestedTemporaryDeveloperLogin = isTemporaryDeveloperLogin && isTruthyFlag(body.temporaryDeveloperLogin);
    if (!identifier) {
      return sendJson(res, 400, { ok: false, message: 'Email or staff ID is required.' });
    }
    if (requestedTemporaryDeveloperLogin && !isLocalDevelopmentRequest(req)) {
      return sendJson(res, 403, { ok: false, message: 'Temporary developer login is disabled here.' });
    }
    if (requestedTemporaryDeveloperLogin && !code) {
      const bundle = await buildTemporaryDeveloperBundle({
        userId: normalizeEmail(identifier) || 'developer-session',
        mockMode: body.mockMode,
        mockRoleOverride: body.mockRoleOverride,
      });
      const token = createAuthSession(bundle.user.userId);
      return sendJson(res, 200, {
        ok: true,
        token,
        bundle,
      });
    }
    const firebasePasswordAuth = identifier.includes('@')
      ? await verifyFirebaseEmailPassword(identifier, code)
      : { ok: false, reason: 'not_email' };
    let userDoc = null;
    if (firebasePasswordAuth.ok && firebasePasswordAuth.localId && firebaseDb) {
      const firebaseUserSnap = await firebaseDb.collection('users').doc(firebasePasswordAuth.localId).get().catch(() => null);
      if (firebaseUserSnap?.exists) {
        userDoc = firebaseUserSnap;
      }
    }
    if (!userDoc) {
      userDoc = await findUserDocByIdentifier(identifier);
    }
    if (!userDoc) {
      return sendJson(res, 404, { ok: false, message: 'No matching Firebase user found.' });
    }
    const userData = userDoc.data() || {};
    if (!firebasePasswordAuth.ok && !matchesLoginCode(userData, code)) {
      return sendJson(res, 401, { ok: false, message: 'Incorrect password or access code.' });
    }

    const bundle = await withTimeout(
      fetchUserBundle(
        userDoc.id,
        isTemporaryDeveloperLogin ? 'Developer' : body.roleOverride,
        body.mockMode,
        body.mockRoleOverride,
      ),
      8000,
      null,
    );
    if (!bundle) {
      return sendJson(res, 504, { ok: false, message: 'User data took too long to load. Please try again.' });
    }

    if (isTemporaryDeveloperLogin && bundle?.user) {
      bundle.user.sourceRole = bundle.user.role;
      bundle.user.role = 'Developer';
      bundle.user.roleLabel = 'Developer';
      bundle.user.roleOverride = 'Developer';
      bundle.roleProfile = getRoleProfile('Developer');
      if (!bundle.developerDashboard) {
        bundle.developerDashboard = await buildDeveloperDashboardData({
          currentUserId: bundle.user.userId,
          userData: bundle.user,
          roleProfile: bundle.roleProfile,
        });
      }
    }

    const token = createAuthSession(bundle.user.userId);
    return sendJson(res, 200, {
      ok: true,
      token,
      bundle,
    });
  } catch (error) {
    console.error('[auth-sign-in] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to sign in.' });
  }
}

async function buildTemporaryDeveloperBundle({ userId = 'developer-session', mockMode = false, mockRoleOverride = null } = {}) {
  const roleProfile = getRoleProfile('Developer');
  const stats = normalizeStats();
  const xp = 0;
  const level = calculateLevel(xp);
  const focusTrait = 'trust';
  const strongTrait = 'relationship';
  const dealershipId = 'developer-lab';
  const lessonCategory = pickRoleLessonCategory('Developer', roleProfile.roleType, focusTrait, `${userId}:${dateKey(new Date())}`);
  const lessonProfile = getLessonCategoryProfile(lessonCategory);
  const lessonLibrary = buildLessonLibrary('Developer', roleProfile.roleType, focusTrait, lessonCategory);
  const focus = buildManagerTodayFocus(roleProfile, focusTrait, `${userId}:${dateKey(new Date())}`);
  const freshUpExperience = getFreshUpExperience('Developer', roleProfile.roleType);
  const developerDashboard = await buildDeveloperDashboardData({
    currentUserId: userId,
    userData: {
      role: 'Developer',
      mockMode,
      mockRoleOverride,
      stats,
      xp,
      freshUpMeter: 0,
      freshUpAvailable: false,
      dealershipId: 'developer-lab',
      dealershipIds: ['developer-lab'],
      selfDeclaredDealershipId: 'developer-lab',
      dealershipName: 'Developer Lab',
    },
    roleProfile,
  });

  return {
    user: {
      userId,
      name: 'Andrew',
      email: 'andrew@autoknerd.com',
      sourceRole: 'Developer',
      role: 'Developer',
      roleLabel: 'Developer',
      dealershipId,
      dealershipIds: [dealershipId],
      selfDeclaredDealershipId: dealershipId,
      dealershipName: 'Developer Lab',
      stats,
      xp,
      level,
      streak: 0,
      momentumScore: 0,
      focusTrait,
      strongTrait,
      freshUpMeter: 0,
      freshUpAvailable: false,
      freshUpCoreSessionsSinceLast: 0,
      roleType: roleProfile.roleType,
      roleScope: roleProfile.maxEnrollmentScope,
      visibilityScope: roleProfile.visibilityScope,
      lessonCategory,
      roleOverride: 'Developer',
      mockMode,
      mockRoleOverride,
    },
    recentSessions: [],
    badges: [],
    focus,
    lessonProfile,
    lessonLibrary,
    freshUpExperience,
    managerDashboard: null,
    developerDashboard,
    roleProfile,
    insight: 'Developer access is ready. Use the console to inspect live dealership data.',
  };
}

function buildEnrollmentProfile(roleLabel) {
  const normalizedRole = normalizeRoleLabel(roleLabel || 'Sales Consultant');
  const roleProfile = getRoleProfile(normalizedRole);
  const visibilityScope = getVisibilityScopeForRole(normalizedRole);
  return {
    roleLabel: normalizedRole,
    roleType: roleProfile.roleType,
    roleScope: roleProfile.maxEnrollmentScope || null,
    visibilityScope,
    visibilityScopeLabel: getVisibilityScopeLabel(visibilityScope),
    visibilityScopeDescription: getVisibilityScopeDescription(visibilityScope),
  };
}

async function lookupEnrollmentLink(code) {
  const dealership = await lookupDealershipByEnrollmentCode(code);
  if (!dealership) return null;
  return {
    type: 'dealerships',
    id: dealership.id,
    data: dealership.data || {},
    field: dealership.field || 'enrollmentCode',
  };
}

async function handleAuthEnroll(req, res) {
  try {
    const body = await readBody(req);
    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();
    const name = String(body.name || '').trim() || [firstName, lastName].filter(Boolean).join(' ').trim();
    const email = String(body.email || '').trim();
    const staffId = String(body.staffId || body.userId || '').trim();
    const roleLabel = normalizeRoleLabel(body.role || body.roleLabel || 'Sales Consultant');
    const roleProfile = getRoleProfile(roleLabel);
    const visibilityScope = getVisibilityScopeForRole(roleLabel);
    const enrollmentCode = normalizeEnrollmentCode(body.enrollmentCode || body.code || body.dealerCode || body.accessCode || '');
    const dealershipRecord = enrollmentCode ? await lookupDealershipByEnrollmentCode(enrollmentCode) : null;

    if (!name) {
      return sendJson(res, 400, { ok: false, message: 'First and last name are required.' });
    }
    if (!email && !staffId) {
      return sendJson(res, 400, { ok: false, message: 'Email or staff ID is required.' });
    }
    if (!enrollmentCode) {
      return sendJson(res, 400, { ok: false, message: 'An enrollment code is required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Enrollment requires Firebase.' });
    }
    if (!dealershipRecord) {
      return sendJson(res, 404, { ok: false, message: 'Enrollment code not found.' });
    }

    const dealershipData = dealershipRecord.data || {};
    if (dealershipData.active === false) {
      return sendJson(res, 403, { ok: false, message: 'This dealership enrollment code is inactive.' });
    }

    const existingDoc = await findUserDocByIdentifier(email || staffId);
    const userId = existingDoc?.id || body.userId || crypto.randomUUID();
    const dealershipId = String(dealershipRecord.id || '').trim();
    const dealershipName = String(dealershipData.name || dealershipData.dealer_name || dealershipData.storeName || dealershipId).trim();
    const dealershipIds = Array.from(new Set([
      dealershipId,
      ...(Array.isArray(body.dealershipIds) ? body.dealershipIds : []),
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    const invitedBy = String(body.invitedBy || '').trim();
    const managerId = String(body.managerId || '').trim();
    const enrollments = {
      userId,
      firstName,
      lastName,
      name,
      email: email || undefined,
      loginEmail: email || undefined,
      emailLower: email ? normalizeEmail(email) : undefined,
      staffId: staffId || undefined,
      employeeId: staffId || undefined,
      role: roleLabel,
      roleLabel,
      roleType: roleProfile.roleType,
      roleScope: roleProfile.maxEnrollmentScope || null,
      visibilityScope,
      visibilityScopeLabel: getVisibilityScopeLabel(visibilityScope),
      visibilityScopeDescription: getVisibilityScopeDescription(visibilityScope),
      enrollmentType: 'dealer_code',
      enrollmentMode: 'dealer_code',
      enrollmentStatus: 'active',
      invitedBy: invitedBy || undefined,
      managerId: managerId || undefined,
      parentUserId: managerId || invitedBy || undefined,
      dealershipId: dealershipId || undefined,
      selfDeclaredDealershipId: dealershipId || undefined,
      dealershipIds: dealershipIds.length ? dealershipIds : undefined,
      dealershipName: dealershipName || undefined,
      dealershipEnrollmentCode: enrollmentCode || undefined,
      dealerCode: enrollmentCode || undefined,
      inviteCode: enrollmentCode || undefined,
      createdAt: existingDoc ? existingDoc.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    Object.keys(enrollments).forEach((key) => {
      if (enrollments[key] === undefined) {
        delete enrollments[key];
      }
    });

    const safeDefaults = {
      xp: Number(existingDoc?.data()?.xp || 0),
      streak: Number(existingDoc?.data()?.streak || 0),
      freshUpMeter: Number(existingDoc?.data()?.freshUpMeter || 0),
      freshUpAvailable: Boolean(existingDoc?.data()?.freshUpAvailable),
    };

    await firebaseDb.collection('users').doc(userId).set({
      ...safeDefaults,
      ...enrollments,
      preferences: {
        ...(existingDoc?.data()?.preferences && typeof existingDoc.data().preferences === 'object' ? existingDoc.data().preferences : {}),
        ...(body.preferences && typeof body.preferences === 'object' ? body.preferences : {}),
      },
    }, { merge: true });

    const bundle = await fetchUserBundle(userId, null, body.mockMode, body.mockRoleOverride);
    if (!bundle) {
      return sendJson(res, 404, { ok: false, message: 'Unable to load newly enrolled user.' });
    }
    const token = createAuthSession(bundle.user.userId);
    return sendJson(res, 200, {
      ok: true,
      token,
      bundle,
      enrollment: {
        userId,
        roleLabel,
        visibilityScope,
        visibilityScopeLabel: getVisibilityScopeLabel(visibilityScope),
        visibilityScopeDescription: getVisibilityScopeDescription(visibilityScope),
        enrollmentType: 'dealer_code',
        dealershipId: dealershipId || null,
        dealershipName: dealershipName || null,
        enrollmentCode,
      },
    });
  } catch (error) {
    console.error('[auth-enroll] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to enroll account.' });
  }
}

async function handleAdminDealershipCreate(req, res) {
  try {
    const body = await readBody(req);
    const token = getRequestToken(req, new URL(req.url, `http://${req.headers.host || 'localhost'}`), body);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }

    const bundle = await fetchUserBundle(authSession.userId, body.roleOverride, body.mockMode, body.mockRoleOverride);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Enrollment requires Firebase.' });
    }

    const name = String(body.name || '').trim();
    const plan = String(body.plan || 'monthly').trim().toLowerCase() || 'monthly';
    const enrollmentCode = normalizeEnrollmentCode(body.enrollmentCode);
    if (!name) {
      return sendJson(res, 400, { ok: false, message: 'A dealership name is required.' });
    }
    if (!enrollmentCode) {
      return sendJson(res, 400, { ok: false, message: 'An enrollment code is required.' });
    }

    const existingEnrollment = await lookupDealershipByEnrollmentCode(enrollmentCode);
    if (existingEnrollment) {
      return sendJson(res, 409, { ok: false, message: 'That enrollment code is already in use.' });
    }

    const dealershipId = await generateUniqueDealershipId(name);
    const dealershipDoc = {
      dealershipId,
      name,
      enrollmentCode,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      plan,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await firebaseDb.collection('dealerships').doc(dealershipId).set(dealershipDoc, { merge: false });
    developerDashboardCache.clear();
    const createdSnap = await firebaseDb.collection('dealerships').doc(dealershipId).get().catch(() => null);
    const createdDealership = serializeDealershipRecord(createdSnap, 0, getRequestOrigin(req));

    return sendJson(res, 200, {
      ok: true,
      dealershipId,
      dealership: createdDealership,
    });
  } catch (error) {
    console.error('[admin-dealership-create] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to create dealership.' });
  }
}

async function handleAdminDealershipList(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = getRequestToken(req, url);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }

    const bundle = await fetchUserBundle(authSession.userId);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Enrollment requires Firebase.' });
    }

    const overview = await buildDealershipAdminOverview({ origin: getRequestOrigin(req) });
    return sendJson(res, 200, {
      ok: true,
      ...overview,
    });
  } catch (error) {
    console.error('[admin-dealership-list] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to load dealership list.' });
  }
}

async function handleAdminUserRemoveFromStore(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const body = await readBody(req);
    const token = getRequestToken(req, url, body);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }
    const bundle = await fetchUserBundle(authSession.userId);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    const targetUserId = String(body.userId || '').trim();
    if (!targetUserId) {
      return sendJson(res, 400, { ok: false, message: 'userId is required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Firebase not available.' });
    }
    await firebaseDb.collection('users').doc(targetUserId).update({
      dealershipId: admin.firestore.FieldValue.delete(),
      selfDeclaredDealershipId: admin.firestore.FieldValue.delete(),
      dealershipIds: admin.firestore.FieldValue.delete(),
      dealershipName: admin.firestore.FieldValue.delete(),
    });
    console.log(`[admin-remove-from-store] cleared dealership fields for user ${targetUserId}`);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('[admin-remove-from-store] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Failed to remove user from store.' });
  }
}

async function handleAdminBackfillDealershipIds(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = getRequestToken(req, url);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }
    const bundle = await fetchUserBundle(authSession.userId);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Firebase not available.' });
    }

    const snap = await firebaseDb.collection('users').get().catch(() => null);
    if (!snap) return sendJson(res, 500, { ok: false, message: 'Could not read users collection.' });

    let updated = 0;
    let skipped = 0;
    const batch = firebaseDb.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const dealershipId = String(data.dealershipId || '').trim();
      const selfDeclaredId = String(data.selfDeclaredDealershipId || '').trim();

      // Already has a canonical dealershipId — nothing to fix
      if (dealershipId) { skipped += 1; continue; }
      // No dealership data at all — skip
      if (!selfDeclaredId) { skipped += 1; continue; }

      // Promote selfDeclaredDealershipId → dealershipId
      batch.update(doc.ref, { dealershipId: selfDeclaredId });
      updated += 1;
      batchCount += 1;

      // Firestore batches are capped at 500 ops
      if (batchCount >= 490) {
        await batch.commit();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();

    console.log(`[backfill-dealership-ids] updated=${updated} skipped=${skipped}`);
    return sendJson(res, 200, { ok: true, updated, skipped });
  } catch (error) {
    console.error('[backfill-dealership-ids] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Backfill failed.' });
  }
}

async function handleAdminBackfillDealershipNames(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = getRequestToken(req, url);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }
    const bundle = await fetchUserBundle(authSession.userId);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Firebase not available.' });
    }

    const snap = await firebaseDb.collection('users').get().catch(() => null);
    if (!snap) return sendJson(res, 500, { ok: false, message: 'Could not read users collection.' });

    const dealershipIds = [];
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const displayId = getDealershipDisplayId(data);
      if (displayId) dealershipIds.push(displayId);
    }

    const dealershipNameMap = await fetchDealershipNameMap(dealershipIds);
    let updated = 0;
    let skipped = 0;
    let missingDealership = 0;
    let batch = firebaseDb.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const displayId = getDealershipDisplayId(data);
      const existingName = String(data.dealershipName || '').trim();
      if (!displayId) {
        skipped += 1;
        continue;
      }
      const resolvedName = String(dealershipNameMap.get(displayId) || '').trim();
      if (!resolvedName || resolvedName === displayId) {
        missingDealership += 1;
        continue;
      }
      if (existingName === resolvedName) {
        skipped += 1;
        continue;
      }

      batch.update(doc.ref, {
        dealershipName: resolvedName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      updated += 1;
      batchCount += 1;

      if (batchCount >= 490) {
        await batch.commit();
        batch = firebaseDb.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();
    developerDashboardCache.clear();

    console.log(`[backfill-dealership-names] updated=${updated} skipped=${skipped} missingDealership=${missingDealership}`);
    return sendJson(res, 200, { ok: true, updated, skipped, missingDealership });
  } catch (error) {
    console.error('[backfill-dealership-names] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Backfill failed.' });
  }
}

async function handleAdminSystemStatus(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = getRequestToken(req, url);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }

    const bundle = await fetchUserBundle(authSession.userId);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }

    const status = await buildDeveloperSystemStatus();
    return sendJson(res, 200, {
      ok: true,
      status,
    });
  } catch (error) {
    console.error('[admin-system-status] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to load system status.' });
  }
}

async function handleAdminUserUpdateDealership(req, res) {
  try {
    const body = await readBody(req);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = getRequestToken(req, url, body);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }

    const bundle = await fetchUserBundle(authSession.userId, body.roleOverride, body.mockMode, body.mockRoleOverride);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Enrollment requires Firebase.' });
    }

    const targetUserId = String(body.userId || '').trim();
    if (!targetUserId) {
      return sendJson(res, 400, { ok: false, message: 'A userId is required.' });
    }

    const targetDoc = await findUserDocByIdentifier(targetUserId);
    if (!targetDoc?.exists) {
      return sendJson(res, 404, { ok: false, message: 'No matching user found.' });
    }

    const targetUserData = targetDoc.data() || {};
    const nextDealershipId = String(body.dealershipId || '').trim();
    const resetProgress = isTruthyFlag(body.resetProgress);
    const deactivate = isTruthyFlag(body.deactivate);
    const reactivate = isTruthyFlag(body.reactivate);

    let nextDealership = null;
    if (nextDealershipId) {
      nextDealership = await lookupDealershipById(nextDealershipId);
      if (!nextDealership) {
        return sendJson(res, 404, { ok: false, message: 'That dealership was not found.' });
      }
      if (nextDealership.data?.active === false) {
        return sendJson(res, 400, { ok: false, message: 'That dealership is inactive.' });
      }
    }

    const nextDealershipName = nextDealership
      ? String(nextDealership.data?.name || nextDealership.data?.dealer_name || nextDealership.data?.storeName || nextDealershipId).trim()
      : String(targetUserData.dealershipName || targetUserData.storeName || targetUserData.companyName || '').trim();
    const nextDealershipEnrollmentCode = nextDealership
      ? normalizeEnrollmentCode(nextDealership.data?.enrollmentCode || '')
      : String(targetUserData.dealershipEnrollmentCode || targetUserData.dealerCode || targetUserData.inviteCode || targetUserData.accessCode || '').trim();

    const nextDealershipIds = Array.from(new Set([
      nextDealershipId,
      ...getResolvedDealershipIds(targetUserData),
      String(targetUserData.dealershipId || '').trim(),
      String(targetUserData.selfDeclaredDealershipId || '').trim(),
    ].filter(Boolean)));

    const updates = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (nextDealershipId) {
      updates.dealershipId = nextDealershipId;
      updates.selfDeclaredDealershipId = nextDealershipId;
      updates.dealershipIds = nextDealershipIds;
      updates.dealershipName = nextDealershipName || nextDealershipId;
      updates.dealershipEnrollmentCode = nextDealershipEnrollmentCode || undefined;
      updates.dealerCode = nextDealershipEnrollmentCode || undefined;
      updates.inviteCode = nextDealershipEnrollmentCode || undefined;
    }

    if (resetProgress) {
      updates.xp = 0;
      updates.streak = 0;
      updates.freshUpMeter = 0;
      updates.freshUpAvailable = false;
      updates.stats = getDefaultStats();
      updates.recentSession = null;
      updates.recentSessions = [];
      updates.lastLesson = null;
      updates.lastLessonAt = null;
      updates.lastActiveAt = null;
    }

    if (deactivate) {
      updates.active = false;
      updates.accountStatus = 'inactive';
      updates.deactivatedAt = admin.firestore.FieldValue.serverTimestamp();
    } else if (reactivate) {
      updates.active = true;
      updates.accountStatus = 'active';
      updates.reactivatedAt = admin.firestore.FieldValue.serverTimestamp();
    }

    Object.keys(updates).forEach((key) => {
      if (updates[key] === undefined) {
        delete updates[key];
      }
    });

    await firebaseDb.collection('users').doc(targetDoc.id).set(updates, { merge: true });
    clearActiveSessionsForUser({ userId: targetDoc.id, email: targetUserData.email, loginEmail: targetUserData.loginEmail, staffId: targetUserData.staffId });
    developerDashboardCache.clear();

    const refreshedBundle = await fetchUserBundle(targetDoc.id, body.roleOverride, body.mockMode, body.mockRoleOverride);
    return sendJson(res, 200, {
      ok: true,
      userId: targetDoc.id,
      updates: {
        dealershipId: nextDealershipId || null,
        dealershipName: nextDealershipName || null,
        resetProgress,
        deactivate,
        reactivate,
      },
      user: refreshedBundle?.user || {
        ...targetUserData,
        ...updates,
      },
      bundle: refreshedBundle || null,
    });
  } catch (error) {
    console.error('[admin-user-update-dealership] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to update the user.' });
  }
}

async function handleAdminSessionsList(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = getRequestToken(req, url);
    const authSession = getAuthSession(token);
    if (!authSession?.userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }

    const bundle = await fetchUserBundle(authSession.userId);
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user.roleLabel || bundle.user.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    if (!firebaseDb) {
      return sendJson(res, 500, { ok: false, message: 'Firestore is unavailable.' });
    }

    const targetUserId = String(url.searchParams.get('userId') || '').trim();
    if (!targetUserId) {
      return sendJson(res, 400, { ok: false, message: 'A userId query parameter is required.' });
    }

    const targetBundle = await fetchUserBundle(targetUserId);
    if (!targetBundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No matching user found.' });
    }

    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 10) || 10));
    const dealershipIdFilter = String(url.searchParams.get('dealershipId') || '').trim();
    const sessionsSnap = await firebaseDb.collection('sessions')
      .where('userId', '==', targetUserId)
      .get()
      .catch(() => null);

    const sessions = (sessionsSnap?.docs || [])
      .map(serializeSessionRecord)
      .filter((session) => !dealershipIdFilter || session.dealershipId === dealershipIdFilter)
      .sort((left, right) => {
        const leftTime = toDate(left.completedAt || left.updatedAt || left.startedAt || left.createdAt)?.getTime() || 0;
        const rightTime = toDate(right.completedAt || right.updatedAt || right.startedAt || right.createdAt)?.getTime() || 0;
        return rightTime - leftTime;
      })
      .slice(0, limit);

    return sendJson(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      user: {
        userId: targetBundle.user.userId,
        name: targetBundle.user.name || '',
        email: targetBundle.user.email || targetBundle.user.loginEmail || '',
        roleLabel: targetBundle.user.roleLabel || normalizeRoleLabel(targetBundle.user.role),
        dealershipId: String(targetBundle.user.dealershipId || '').trim() || null,
        dealershipName: String(targetBundle.user.dealershipName || '').trim() || null,
      },
      summary: {
        totalSessions: sessionsSnap?.docs?.length || 0,
        returnedSessions: sessions.length,
        completedSessions: sessions.filter((session) => session.status === 'completed').length,
      },
      sessions,
    });
  } catch (error) {
    console.error('[admin-sessions-list] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to load sessions.' });
  }
}

async function handleAuthSignOut(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const body = req.method === 'POST' ? await readBody(req).catch(() => ({})) : {};
    const token = getRequestToken(req, url, body);
    clearAuthSession(token);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('[auth-sign-out] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to sign out.' });
  }
}

async function handleDeveloperDashboard(req, res, url) {
  try {
    const body = req.method === 'POST' ? await readBody(req).catch(() => ({})) : {};
    const roleOverride = body.roleOverride || url.searchParams.get('roleOverride') || undefined;
    const mockMode = body.mockMode || url.searchParams.get('mockMode') || undefined;
    const mockRoleOverride = body.mockRoleOverride || url.searchParams.get('mockRoleOverride') || undefined;
    const dealershipId = String(body.dealershipId || url.searchParams.get('dealershipId') || '').trim();
    const token = getRequestToken(req, url, body);
    const userId = getAuthSession(token)?.userId || url.searchParams.get('userId') || '';
    if (!userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }
    const bundle = await fetchUserBundle(userId, roleOverride, mockMode, mockRoleOverride);
    if (!bundle) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const roleLabel = normalizeRoleLabel(bundle.user?.roleLabel || bundle.user?.role);
    if (!isPrivilegedDealershipRole(roleLabel)) {
      return sendJson(res, 403, { ok: false, message: 'Developer or Admin access required.' });
    }
    const dashboard = await withTimeout(
      buildDeveloperDashboardData({
        currentUserId: bundle.user.userId,
        userData: bundle.user,
        roleProfile: bundle.roleProfile,
        dealershipId,
      }),
      8000,
      null,
    );
    return sendJson(res, 200, {
      ok: true,
      dashboard,
      dashboardStatus: dashboard ? 'live' : 'offline',
      message: dashboard ? null : 'Developer dashboard is unavailable right now.',
      dealershipId: dealershipId || null,
    });
  } catch (error) {
    console.error('[developer-dashboard] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to load developer data.' });
  }
}

async function generateAutoForgeLessonPlan(bundle, storeSelection = 'all') {
  const context = buildAutoForgeContextFromBundle(bundle, storeSelection);
  const prompt = buildAutoForgePrompt(context);
  const fallback = buildAutoForgeFallbackReport(context);
  const report = await withTimeout(callGeminiText(prompt, fallback), 12000, fallback);
  const normalizedReport = normalizeAutoForgePlanTitle(replaceAutoForgeDataSection(report, context), context);
  return {
    report: normalizedReport.trim(),
    planTitle: extractAutoForgePlanTitle(normalizedReport) || buildAutoForgePlanTitle(context),
    theme: extractAutoForgePrimaryTheme(normalizedReport),
    generatedAt: new Date().toISOString(),
    ...context,
  };
}

async function handleAutoForgeLessonPlan(req, res) {
  let body = {};
  try {
    body = await readBody(req);
    const bundle = await fetchUserBundle(body.userId, body.roleOverride, body.mockMode, body.mockRoleOverride);
    if (!bundle) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }

    const lessonPlan = await generateAutoForgeLessonPlan(bundle, body.storeSelection || 'all');
    return sendJson(res, 200, {
      ok: true,
      ...lessonPlan,
      title: lessonPlan.planTitle || 'AutoKnerd Coaching Plan',
    });
  } catch (error) {
    console.error('[autoforge-lesson-plan] failed', error);
    try {
      const bundle = await fetchUserBundle(body.userId, body.roleOverride, body.mockMode, body.mockRoleOverride);
      if (bundle) {
        const context = buildAutoForgeContextFromBundle(bundle, body.storeSelection || 'all');
        const fallbackReport = buildAutoForgeFallbackReport(context);
        return sendJson(res, 200, {
          ok: true,
          report: fallbackReport,
          planTitle: extractAutoForgePlanTitle(fallbackReport) || buildAutoForgePlanTitle(context),
          theme: extractAutoForgePrimaryTheme(fallbackReport),
          generatedAt: new Date().toISOString(),
          title: extractAutoForgePlanTitle(fallbackReport) || 'AutoKnerd Coaching Plan',
          ...context,
          degraded: true,
        });
      }
    } catch (fallbackError) {
      console.error('[autoforge-lesson-plan:fallback] failed', fallbackError);
    }
    return sendJson(res, 500, { ok: false, message: 'Unable to generate AutoForge lesson plan.' });
  }
}

async function handleAutoForgeExportPdf(req, res) {
  try {
    const body = await readBody(req);
    if (typeof body.report !== 'string' || !body.report.trim()) {
      return sendJson(res, 400, { ok: false, message: 'AutoForge report text is required.' });
    }

    const buffer = await buildAutoForgePdf(body.report, body.department, body.dealershipName);
    const departmentPart = safeFilename(body.department || 'autoforge');
    const dealershipPart = safeFilename(body.dealershipName || 'report');
    const themePart = safeFilename(extractAutoForgePrimaryTheme(body.report));
    const filename = `autoforge-${departmentPart}-${dealershipPart}-${themePart || 'lesson'}.pdf`;

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    return res.end(Buffer.from(buffer));
  } catch (error) {
    console.error('[autoforge-export] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Could not generate AutoForge PDF.' });
  }
}

async function handleStartSession(req, res) {
  try {
    const body = await readBody(req);
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = getRequestToken(req, url, body);
    const authenticatedUserId = getAuthSession(token)?.userId || '';
    const requestedUserId = String(body.userId || '').trim();
    const userId = authenticatedUserId || requestedUserId;
    if (!userId) {
      return sendJson(res, 401, { ok: false, authRequired: true, message: 'Sign in required.' });
    }

    const bundle = await fetchUserBundle(userId, body.roleOverride, body.mockMode, body.mockRoleOverride);
    if (!bundle) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }
    const dealershipId = String(bundle.user?.dealershipId || bundle.user?.selfDeclaredDealershipId || '').trim();
    if (!dealershipId) {
      return sendJson(res, 400, { ok: false, message: 'Authenticated user is missing a dealership assignment.' });
    }
    const dealershipIds = Array.from(new Set([
      dealershipId,
      ...getResolvedDealershipIds(bundle.user),
    ]));
    const dealershipName = String(bundle.user?.dealershipName || bundle.user?.storeName || bundle.user?.companyName || '').trim();

    const isFreshUp = isTruthyFlag(body.freshUp);
    const allowedCategories = getRoleLessonCategories(bundle.roleProfile?.roleLabel || bundle.user.role, bundle.roleProfile?.roleType || bundle.user.roleType);
    const requestedLessonCategory = isFreshUp
      ? null
      : allowedCategories.includes(String(body.lessonCategory || body.lessonCategoryOverride || '').trim())
        ? String(body.lessonCategory || body.lessonCategoryOverride || '').trim()
        : null;
    const mission = await generateStartSession(bundle, requestedLessonCategory, { freshUp: isFreshUp });
    const sessionId = crypto.randomUUID();
    clearActiveSessionsForUser(bundle.user);
    const startingRatings = {
      empathy: BASELINE,
      listening: BASELINE,
      trust: BASELINE,
      followUp: BASELINE,
      closing: BASELINE,
      relationship: BASELINE,
    };
    const messages = [
      { sender: 'ai', speaker: 'Sprocket', text: mission.coachLine },
      { sender: 'ai', speaker: mission.customerName, text: mission.customerOpening },
    ];

    activeSessions.set(sessionId, {
      sessionId,
      userId: bundle.user.userId,
      userLookupKeys: buildSessionUserKeys(bundle.user),
      role: bundle.user.role,
      roleLabel: bundle.user.roleLabel || normalizeRoleLabel(bundle.user.role),
      focusTrait: bundle.user.focusTrait,
      roleType: bundle.user.roleType || resolveAisRoleType(bundle.user.role),
      roleProfile: bundle.roleProfile,
      dealershipId,
      dealershipIds,
      dealershipName,
      roleOverride: bundle.user.roleOverride || null,
      mockRoleOverride: body.mockRoleOverride || bundle.user.roleOverride || null,
      mockMode: bundle.mockMode || false,
      activitySource: mission.activitySource || (isFreshUp ? 'fresh-up' : 'core'),
      lessonId: mission.lessonId || (isFreshUp ? 'fresh-up' : null),
      lessonCategory: mission.lessonCategory || bundle.lessonCategory || null,
      lessonTitle: mission.lessonTitle || null,
      freshUpSystemLabel: mission.freshUpSystemLabel || bundle.freshUpSystemLabel || bundle.freshUpExperience?.systemLabel || null,
      freshUpBossLabel: mission.freshUpBossLabel || bundle.freshUpBossLabel || bundle.freshUpExperience?.bossLabel || null,
      freshUpAudience: mission.freshUpAudience || bundle.freshUpExperience?.audience || null,
      freshUpReadyCopy: mission.freshUpReadyCopy || bundle.freshUpExperience?.readyCopy || null,
      freshUpLockedCopy: mission.freshUpLockedCopy || bundle.freshUpExperience?.lockedCopy || null,
      title: mission.title,
      description: mission.description,
      coachLine: mission.coachLine,
      customerName: mission.customerName,
      customerOpening: mission.customerOpening,
      focus: mission.focus,
      trustLabel: mission.trustLabel,
      targetUserTurns: mission.targetUserTurns,
      currentUserTurns: 0,
      scenarioSummary: mission.scenarioSummary,
      customerConcern: mission.customerConcern,
      choices: mission.choices,
      startedAt: new Date().toISOString(),
      messages,
      runningRatings: startingRatings,
      turnXpTotal: 0,
      responseModeCounts: { multiple_choice: 0, verbatim: 0 },
    });
    const sessionPayload = serializeActiveSession(activeSessions.get(sessionId));
    if (!bundle.mockMode) {
      try {
        await persistSessionDocument(sessionId, {
          userId: bundle.user.userId,
          dealershipId,
          dealershipIds,
          dealershipName: dealershipName || null,
          role: bundle.user.role,
          roleLabel: bundle.user.roleLabel || normalizeRoleLabel(bundle.user.role),
          roleType: bundle.user.roleType || resolveAisRoleType(bundle.user.role),
          activitySource: mission.activitySource || (isFreshUp ? 'fresh-up' : 'core'),
          lessonId: mission.lessonId || (isFreshUp ? 'fresh-up' : null),
          lessonCategory: mission.lessonCategory || bundle.lessonCategory || null,
          lessonTitle: mission.lessonTitle || null,
          title: mission.title,
          description: mission.description,
          coachLine: mission.coachLine,
          customerName: mission.customerName,
          customerOpening: mission.customerOpening,
          focus: mission.focus,
          trustLabel: mission.trustLabel,
          targetUserTurns: mission.targetUserTurns,
          currentUserTurns: 0,
          scenarioSummary: mission.scenarioSummary,
          customerConcern: mission.customerConcern,
          choices: mission.choices,
          startedAt: admin.firestore.Timestamp.fromDate(new Date()),
          status: 'active',
          runningRatings: startingRatings,
          responseModeCounts: { multiple_choice: 0, verbatim: 0 },
          messages,
          session: sessionPayload,
        }, { includeCreatedAt: true });
      } catch (sessionError) {
        console.warn('[start-session] unable to persist session doc', sessionError.message);
      }
    }

    return sendJson(res, 200, {
      ok: true,
      sessionId,
      mission: sessionPayload,
      session: sessionPayload,
      user: bundle.user,
      recentSessions: bundle.recentSessions,
      insight: bundle.insight,
    });
  } catch (error) {
    console.error('[start-session] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to start session.' });
  }
}

async function handleUpdateUserProfile(req, res) {
  try {
    const body = await readBody(req);
    const userId = String(body.userId || '').trim();
    if (!userId) {
      return sendJson(res, 400, { ok: false, message: 'A userId is required.' });
    }

    const bundle = await fetchUserBundle(
      userId,
      body.roleOverride,
      body.mockMode,
      body.mockRoleOverride
    );
    if (!bundle?.user) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }

    const nextFirstName = String(body.firstName || '').trim();
    const nextLastName = String(body.lastName || '').trim();
    const nextName = String(body.name || '').trim() || [nextFirstName, nextLastName].filter(Boolean).join(' ').trim() || String(bundle.user.name || '').trim();
    const nextAvatarUrl = String(body.avatarUrl || bundle.user.avatarUrl || '').trim();
    const nextPreferences = {
      ...((bundle.user.preferences && typeof bundle.user.preferences === 'object') ? bundle.user.preferences : {}),
      ...(body.preferences && typeof body.preferences === 'object' ? body.preferences : {}),
    };

    const updates = {
      name: nextName || bundle.user.name || 'Current account',
      avatarUrl: nextAvatarUrl || '',
      preferences: nextPreferences,
    };
    if (nextFirstName) updates.firstName = nextFirstName;
    if (nextLastName) updates.lastName = nextLastName;

    if (!isTruthyFlag(body.mockMode) && firebaseDb) {
      await firebaseDb.collection('users').doc(userId).set(updates, { merge: true });
    }

    const updatedUser = {
      ...bundle.user,
      ...updates,
      name: updates.name,
      avatarUrl: updates.avatarUrl,
      preferences: nextPreferences,
    };

    const refreshedBundle = isTruthyFlag(body.mockMode)
      ? {
          ...bundle,
          user: updatedUser,
        }
      : await fetchUserBundle(userId, body.roleOverride, body.mockMode, body.mockRoleOverride);

    developerDashboardCache.clear();
    return sendJson(res, 200, {
      ok: true,
      user: refreshedBundle?.user || updatedUser,
      bundle: refreshedBundle || { ...bundle, user: updatedUser },
    });
  } catch (error) {
    console.error('[update-user-profile] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to update profile.' });
  }
}

function getNumericRatings(ratings) {
  return {
    empathy: clampScore(ratings?.empathy),
    listening: clampScore(ratings?.listening),
    trust: clampScore(ratings?.trust),
    followUp: clampScore(ratings?.followUp),
    closing: clampScore(ratings?.closing),
    relationship: clampScore(ratings?.relationship),
  };
}

async function updateUserAfterSession(bundle, result, session, answer) {
  const now = new Date();
  const normalizedRatings = getNumericRatings(result.ratings);
  const activitySource = session.activitySource || 'core';
  const lessonId = session.lessonId || session.lessonCategory || session.sessionId;
  const resolvedDealershipId = String(bundle.user?.dealershipId || bundle.user?.selfDeclaredDealershipId || '').trim();
  const averageRating = Math.round((
    normalizedRatings.empathy +
    normalizedRatings.listening +
    normalizedRatings.trust +
    normalizedRatings.followUp +
    normalizedRatings.closing +
    normalizedRatings.relationship
  ) / 6);

  if (bundle.mockMode || !firebaseDb) {
    const currentStats = normalizeStats(bundle.user?.stats);
    const nextStats = {};
    for (const key of ['empathy', 'listening', 'trust', 'followUp', 'closing', 'relationship']) {
      const currentScore = clampScore(currentStats[key]?.score);
      const ratingDelta = normalizedRatings[key] - currentScore;
      const stepDelta = clampDelta(Math.round(ratingDelta * 0.18));
      nextStats[key] = {
        score: clamp(currentScore + stepDelta),
        lastUpdated: admin.firestore.Timestamp.fromDate(now),
      };
    }

    const nextFreshUpState = buildNextFreshUpState({
      user: { ...bundle.user, freshUpMeter: bundle.user?.freshUpMeter, freshUpAvailable: bundle.user?.freshUpAvailable },
      now,
      priorLogs: Array.isArray(bundle.recentSessions)
        ? bundle.recentSessions.map((sessionItem) => ({
            activitySource: String(sessionItem.activitySource || 'core'),
            timestamp: sessionItem.timestamp || now,
          }))
        : [],
      ratings: normalizedRatings,
      activitySource,
      lessonId,
    });

    return {
      userId: bundle.user.userId,
      ...bundle.user,
      roleLabel: bundle.roleProfile?.roleLabel || normalizeRoleLabel(bundle.user.role),
      roleType: bundle.roleProfile?.roleType || resolveAisRoleType(bundle.user.role),
      roleScope: bundle.roleProfile?.maxEnrollmentScope || getMaxEnrollmentScopeForInviter(bundle.user.role),
      xp: Number(bundle.user.xp || 0) + Number(result.xpAwarded || 0),
      stats: nextStats,
      freshUpMeter: nextFreshUpState.freshUpMeter,
      freshUpAvailable: nextFreshUpState.freshUpAvailable,
    };
  }

  const userRef = firebaseDb.collection('users').doc(bundle.user.userId);

  let updatedUser = null;

  await firebaseDb.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) throw new Error('User not found.');
    const userData = userSnap.data() || {};
    const rawStats = normalizeStats(userData.stats);

    let deltaGain = DEFAULT_CX_AGGRESSIVENESS / 100;
    try {
      const cxConfigRef = firebaseDb.collection('systemSettings').doc('cx');
      const cxConfigSnap = await transaction.get(cxConfigRef);
      deltaGain = normalizeCxAggressiveness(cxConfigSnap.data()?.aggressiveness) / 100;
    } catch {
      // Keep the default when system settings are unavailable.
    }

    const nextStats = {};
    const beforeScores = {};
    const afterScores = {};

    for (const key of ['empathy', 'listening', 'trust', 'followUp', 'closing', 'relationship']) {
      const current = rawStats[key];
      const currentScore = clampScore(current?.score);
      const currentWhole = Math.round(currentScore);
      const lastUpdated = toDate(current?.lastUpdated) || now;
      const deltaDays = Math.max(0, (now.getTime() - lastUpdated.getTime()) / (24 * 60 * 60 * 1000));
      const driftedScore = BASELINE + (currentWhole - BASELINE) * Math.exp(-LAMBDA * deltaDays);
      const driftDelta = driftedScore - currentWhole;
      const ratingDelta = normalizedRatings[key] - currentWhole;
      const rawDelta = driftDelta + ratingDelta * deltaGain;
      const stepDelta = clampDelta(Math.round(rawDelta));
      const updatedScore = clamp(currentWhole + stepDelta);

      nextStats[key] = { score: updatedScore, lastUpdated: admin.firestore.Timestamp.fromDate(now) };
      beforeScores[key] = currentWhole;
      afterScores[key] = updatedScore;
    }

    const xpBefore = Number(userData.xp || 0);
    const xpAfter = xpBefore + Number(result.xpAwarded || 0);
    const nextRecentSession = {
      title: session.title || session.lessonTitle || session.lessonCategory || 'Session',
      timestamp: admin.firestore.Timestamp.fromDate(now),
      score: Number(result.xpAwarded || 0),
      lessonCategory: session.lessonCategory || null,
      activitySource,
    };
    const existingRecentSessions = Array.isArray(userData.recentSessions) ? userData.recentSessions : [];
    const nextRecentSessions = [
      nextRecentSession,
      ...existingRecentSessions.filter((entry) => {
        const title = String(entry?.title || entry?.lessonTitle || '').trim();
        const timestamp = entry?.timestamp || entry?.createdAt || entry?.updatedAt || null;
        return title !== nextRecentSession.title || String(toIso(timestamp) || '') !== String(toIso(nextRecentSession.timestamp) || '');
      }),
    ].slice(0, 3);
    const priorLogsSnap = await userRef.collection('lessonLogs').orderBy('timestamp', 'desc').limit(8).get();
    const priorLogs = priorLogsSnap.docs.map((doc) => ({
      activitySource: String(doc.data()?.activitySource || 'core'),
      timestamp: toDate(doc.data()?.timestamp) || now,
    }));
    const nextFreshUpState = buildNextFreshUpState({
      user: { ...userData, freshUpMeter: userData.freshUpMeter, freshUpAvailable: userData.freshUpAvailable },
      now,
      priorLogs,
      ratings: normalizedRatings,
      activitySource,
      lessonId,
    });

    transaction.set(userRef, {
      xp: xpAfter,
      stats: nextStats,
      ...nextFreshUpState,
      lastActiveAt: admin.firestore.Timestamp.fromDate(now),
      lastLessonAt: admin.firestore.Timestamp.fromDate(now),
      lastLesson: session.title || session.lessonTitle || session.lessonCategory || 'Session',
      lastLessonCategory: session.lessonCategory || null,
      recentSession: nextRecentSession,
      recentSessions: nextRecentSessions,
    }, { merge: true });

    const logRef = userRef.collection('lessonLogs').doc();
    transaction.set(logRef, {
      logId: logRef.id,
      timestamp: admin.firestore.Timestamp.fromDate(now),
      userId: bundle.user.userId,
      dealershipId: resolvedDealershipId || null,
      lessonId,
      activitySource,
      lessonCategory: session.lessonCategory || null,
      completionStatus: 'completed',
      xpGained: Number(result.xpAwarded || 0),
      ratings: normalizedRatings,
      empathy: normalizedRatings.empathy,
      listening: normalizedRatings.listening,
      trust: normalizedRatings.trust,
      followUp: normalizedRatings.followUp,
      closing: normalizedRatings.closing,
      relationship: normalizedRatings.relationship,
      coachSummary: result.coachSummary,
      recommendedNextFocus: result.recommendedNextFocus,
      trustLabel: result.trustLabel,
      severity: result.severity || 'normal',
      flags: Array.isArray(result.flags) ? result.flags : [],
      answer,
      sessionId: session.sessionId,
      sessionTitle: session.title,
      question: session.customerOpening || session.description || session.title,
      answerChoice: answer.choice || null,
      answerText: answer.answer || '',
      conversationLength: Array.isArray(session.messages) ? session.messages.length : 0,
      resultTitle: result.resultTitle,
      resultBody: result.resultBody,
      scoreDelta: {
        empathy: afterScores.empathy - beforeScores.empathy,
        listening: afterScores.listening - beforeScores.listening,
        trust: afterScores.trust - beforeScores.trust,
        followUp: afterScores.followUp - beforeScores.followUp,
        closing: afterScores.closing - beforeScores.closing,
        relationshipBuilding: afterScores.relationship - beforeScores.relationship,
      },
    });

    updatedUser = {
      userId: bundle.user.userId,
      ...userData,
      dealershipId: resolvedDealershipId || userData.dealershipId || '',
      dealershipName: userData.dealershipName || bundle.user?.dealershipName || '',
      roleLabel: bundle.roleProfile?.roleLabel || normalizeRoleLabel(userData.role),
      roleType: bundle.roleProfile?.roleType || resolveAisRoleType(userData.role),
      roleScope: bundle.roleProfile?.maxEnrollmentScope || getMaxEnrollmentScopeForInviter(userData.role),
      xp: xpAfter,
      stats: nextStats,
      freshUpMeter: nextFreshUpState.freshUpMeter,
      freshUpAvailable: nextFreshUpState.freshUpAvailable,
      lastActiveAt: now,
      lastLessonAt: now,
      lastLesson: session.title || session.lessonTitle || session.lessonCategory || 'Session',
      lastLessonCategory: session.lessonCategory || null,
      recentSession: nextRecentSession,
      recentSessions: nextRecentSessions,
    };
  });

  developerDashboardCache.clear();
  return updatedUser;
}

async function handleCompleteSession(req, res) {
  try {
    const body = await readBody(req);
    const session = activeSessions.get(body.sessionId);
    if (!session) {
      return sendJson(res, 404, { ok: false, message: 'Session not found.' });
    }

    const bundle = await fetchUserBundle(
      body.userId || session.userId,
      body.roleOverride || session.roleOverride,
      body.mockMode || session.mockMode,
      body.mockRoleOverride || session.mockRoleOverride
    );
    if (!bundle) {
      return sendJson(res, 404, { ok: false, message: 'No Firebase user found.' });
    }

    const answer = String(body.answer || body.message || '').trim();
    const responseMode = resolveResponseMode(session, body, answer);
    const selectedChoice = String(body.selectedChoice || '').toUpperCase();
    const selectedChoiceText = String(body.selectedChoiceText || '').trim();
    const effectiveAnswer = answer || selectedChoiceText;

    if (!effectiveAnswer) {
      return sendJson(res, 400, { ok: false, message: 'A response is required to continue the lesson.' });
    }

    const activitySource = session.activitySource || 'core';
    const lessonId = session.lessonId || session.lessonCategory || session.sessionId;

    session.messages.push({
      sender: 'user',
      speaker: bundle.user.name || 'You',
      text: effectiveAnswer,
      responseMode,
      selectedChoice: selectedChoice || null,
    });
    session.currentUserTurns = Math.min(Number(session.currentUserTurns || 0) + 1, Number(session.targetUserTurns || 5));
    session.runningRatings = blendRatings(
      session.runningRatings,
      deriveTurnRatingsFromText(effectiveAnswer, session.runningRatings),
      session.currentUserTurns
    );
    session.trustLabel = trustLabelFromValue(session.runningRatings.trust);
    countSelectedResponseMode(session, responseMode);
    const turnXpAwarded = computeTurnXp({ ratings: session.runningRatings, responseMode });
    session.turnXpTotal = Math.max(0, Number(session.turnXpTotal || 0)) + turnXpAwarded;

    if (session.currentUserTurns < session.targetUserTurns) {
      const turn = await generateSessionTurn(bundle, session, { answer });
      session.runningRatings = blendRatings(session.runningRatings, turn.ratings, session.currentUserTurns);
      session.trustLabel = turn.trustLabel;
      session.choices = turn.choices;
      session.messages.push({
        sender: 'ai',
        speaker: session.customerName || 'Customer',
        text: turn.customerReply,
      });
      session.messages.push({
        sender: 'ai',
        speaker: 'Sprocket',
        text: turn.coachNote,
      });

      return sendJson(res, 200, {
        ok: true,
        stage: 'continue',
        sessionId: session.sessionId,
        session: serializeActiveSession(session),
        response: {
          customerReply: turn.customerReply,
          coachNote: turn.coachNote,
          trustLabel: turn.trustLabel,
          choices: turn.choices,
          responseMode,
          turnXpAwarded,
        },
      });
    }

    const result = await generateSessionResult(bundle, session, { answer: effectiveAnswer });
    const userMessages = session.messages
      .filter((message) => String(message.sender || '') === 'user')
      .map((message) => String(message.text || ''));
    const moderation = assessBehaviorViolation({
      userMessages: [...userMessages, effectiveAnswer],
      ratings: result.ratings,
      xpAwarded: result.xpAwarded,
    });
    const finalResult = moderation.violated
      ? {
          ...result,
          severity: 'behavior_violation',
          flags: Array.from(new Set([...(result.flags || []), ...(moderation.flags || [])])),
          ratings: moderation.adjustedRatings || result.ratings,
          xpAwarded: Math.min(0, Math.round(moderation.adjustedXpAwarded ?? result.xpAwarded ?? 0)),
        }
      : {
          ...result,
          xpAwarded: clamp(
            Math.max(Number(session.turnXpTotal || 0), Number(result.xpAwarded || 0)),
            activitySource === 'fresh-up' ? 40 : 10,
            activitySource === 'fresh-up' ? 150 : 100
          ),
        };
    const updatedUser = await updateUserAfterSession(bundle, finalResult, session, {
      choice: null,
      answer: effectiveAnswer,
    });
    activeSessions.delete(body.sessionId);
    if (!bundle.mockMode) {
      try {
        await persistSessionDocument(session.sessionId, {
          userId: session.userId,
          dealershipId: String(session.dealershipId || bundle.user?.dealershipId || bundle.user?.selfDeclaredDealershipId || '').trim() || null,
          dealershipIds: Array.isArray(session.dealershipIds) ? session.dealershipIds : getResolvedDealershipIds(bundle.user),
          dealershipName: String(session.dealershipName || bundle.user?.dealershipName || '').trim() || null,
          role: session.role,
          roleLabel: session.roleLabel,
          roleType: session.roleType,
          activitySource,
          lessonId,
          lessonCategory: session.lessonCategory || null,
          lessonTitle: session.lessonTitle || null,
          title: session.title,
          description: session.description,
          status: 'completed',
          completedAt: admin.firestore.Timestamp.fromDate(new Date()),
          currentUserTurns: session.currentUserTurns,
          targetUserTurns: session.targetUserTurns,
          trustLabel: finalResult.trustLabel || session.trustLabel || null,
          result: {
            severity: finalResult.severity || 'normal',
            xpAwarded: finalResult.xpAwarded || 0,
            flags: Array.isArray(finalResult.flags) ? finalResult.flags : [],
          },
        });
      } catch (sessionError) {
        console.warn('[complete-session] unable to update session doc', sessionError.message);
      }
    }

    const refreshed = bundle.mockMode
      ? {
          user: updatedUser,
          recentSessions: bundle.recentSessions || [],
          badges: bundle.badges || [],
          insight: bundle.insight || '',
          freshUpExperience: bundle.freshUpExperience || null,
          freshUpSystemLabel: bundle.freshUpSystemLabel || null,
          freshUpBossLabel: bundle.freshUpBossLabel || null,
        }
      : await fetchUserBundle(updatedUser.userId, session.roleOverride);
    return sendJson(res, 200, {
      ok: true,
      stage: 'complete',
      result: finalResult,
      updatedUser: refreshed?.user || updatedUser,
      recentSessions: refreshed?.recentSessions || [],
      badges: refreshed?.badges || [],
      insight: refreshed?.insight || bundle.insight,
      session: {
        ...serializeActiveSession(session),
        progress: 100,
      },
    });
  } catch (error) {
    console.error('[complete-session] failed', error);
    return sendJson(res, 500, { ok: false, message: 'Unable to complete session.' });
  }
}

async function routeRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return serveIndex(res);
  }

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    return handleBootstrap(req, res, url);
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/sign-in') {
    return handleAuthSignIn(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/enroll') {
    return handleAuthEnroll(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/dealership/create') {
    return handleAdminDealershipCreate(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/dealerships') {
    return handleAdminDealershipList(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/system-status') {
    return handleAdminSystemStatus(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/sessions') {
    return handleAdminSessionsList(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/user/update-dealership') {
    return handleAdminUserUpdateDealership(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/backfill-dealership-ids') {
    return handleAdminBackfillDealershipIds(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/backfill-dealership-names') {
    return handleAdminBackfillDealershipNames(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/user/remove-from-store') {
    return handleAdminUserRemoveFromStore(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/sign-out') {
    return handleAuthSignOut(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/autoforge/lesson-plan') {
    return handleAutoForgeLessonPlan(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/autoforge/export-pdf') {
    return handleAutoForgeExportPdf(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/tools/insight') {
    return handleToolInsight(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/user/update') {
    return handleUpdateUserProfile(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/session/start') {
    return handleStartSession(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/api/session/complete') {
    return handleCompleteSession(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/api/developer/dashboard') {
    return handleDeveloperDashboard(req, res, url);
  }

  if (req.method === 'GET') {
    const requestPath = decodeURIComponent(url.pathname);
    const normalizedPath = requestPath.replace(/^\/+/, '');
    const staticCandidates = [
      path.join(__dirname, normalizedPath),
      path.join(__dirname, 'public', normalizedPath),
    ];
    const candidate = staticCandidates.find((entry) => (
      entry.startsWith(__dirname)
      && fs.existsSync(entry)
      && fs.statSync(entry).isFile()
    ));
    if (candidate) {
      const ext = path.extname(candidate).toLowerCase();
      const type = ext === '.js'
        ? 'text/javascript; charset=utf-8'
        : ext === '.css'
          ? 'text/css; charset=utf-8'
          : ext === '.png'
            ? 'image/png'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return fs.createReadStream(candidate).pipe(res);
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function initializeFirebase() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) return;
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    firebaseDb = admin.firestore();
  } catch (error) {
    console.warn('[firebase] unable to initialize', error.message);
  }
}

initializeFirebase();

http.createServer((req, res) => {
  routeRequest(req, res).catch((error) => {
    console.error('[server] unhandled error', error);
    sendJson(res, 500, { ok: false, message: 'Internal server error.' });
  });
}).listen(PORT, () => {
  console.log(`AutoKnerd App v2 running at http://localhost:${PORT}`);
});
