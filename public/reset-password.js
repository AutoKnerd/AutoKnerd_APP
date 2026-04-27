import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  appId: 'YOUR_APP_ID',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const el = {
  loadingState: document.getElementById('loading-state'),
  invalidModeState: document.getElementById('invalid-mode-state'),
  invalidCodeState: document.getElementById('invalid-code-state'),
  resetForm: document.getElementById('reset-form'),
  emailDisplay: document.getElementById('email-display'),
  newPassword: document.getElementById('new-password'),
  confirmPassword: document.getElementById('confirm-password'),
  toggleNewPassword: document.getElementById('toggle-new-password'),
  toggleConfirmPassword: document.getElementById('toggle-confirm-password'),
  newPasswordError: document.getElementById('new-password-error'),
  confirmPasswordError: document.getElementById('confirm-password-error'),
  submitError: document.getElementById('submit-error'),
  submitBtn: document.getElementById('submit-btn'),
  successState: document.getElementById('success-state'),
  continueLink: document.getElementById('continue-link'),
};

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');
const oobCode = params.get('oobCode');
const continueUrl = params.get('continueUrl');
const lang = params.get('lang');

if (lang) {
  auth.languageCode = lang;
}

let validatedEmail = '';

function show(node) {
  node?.classList.remove('hidden');
}

function hide(node) {
  node?.classList.add('hidden');
}

function setInlineError(node, message) {
  if (!node) return;
  if (!message) {
    hide(node);
    node.textContent = '';
    return;
  }
  node.textContent = message;
  show(node);
}

function setToggleBehavior(button, input) {
  if (!button || !input) return;
  button.addEventListener('click', () => {
    const nextType = input.type === 'password' ? 'text' : 'password';
    input.type = nextType;
    button.textContent = nextType === 'password' ? 'Show' : 'Hide';
  });
}

function formatResetError(error) {
  const code = error?.code || '';
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
    return 'This reset link is expired or invalid. Please request a new password reset email.';
  }
  if (code === 'auth/weak-password') {
    return 'Your new password is too weak. Use at least 8 characters.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error. Check your connection and try again.';
  }
  return error?.message || 'We could not update your password. Please try again.';
}

function validateForm() {
  const newPasswordValue = String(el.newPassword?.value || '').trim();
  const confirmPasswordValue = String(el.confirmPassword?.value || '').trim();

  let valid = true;

  if (newPasswordValue.length < 8) {
    setInlineError(el.newPasswordError, 'Password must be at least 8 characters.');
    valid = false;
  } else {
    setInlineError(el.newPasswordError, '');
  }

  if (confirmPasswordValue.length < 8) {
    setInlineError(el.confirmPasswordError, 'Please confirm your new password.');
    valid = false;
  } else if (newPasswordValue !== confirmPasswordValue) {
    setInlineError(el.confirmPasswordError, 'Passwords do not match.');
    valid = false;
  } else {
    setInlineError(el.confirmPasswordError, '');
  }

  return {
    valid,
    newPasswordValue,
  };
}

async function initResetFlow() {
  hide(el.invalidModeState);
  hide(el.invalidCodeState);
  hide(el.resetForm);
  hide(el.successState);
  show(el.loadingState);

  if (mode !== 'resetPassword') {
    hide(el.loadingState);
    show(el.invalidModeState);
    return;
  }

  if (!oobCode) {
    hide(el.loadingState);
    show(el.invalidCodeState);
    return;
  }

  try {
    validatedEmail = await verifyPasswordResetCode(auth, oobCode);
    if (el.emailDisplay) {
      el.emailDisplay.textContent = `Account: ${validatedEmail}`;
    }
    hide(el.loadingState);
    show(el.resetForm);
  } catch (_error) {
    hide(el.loadingState);
    show(el.invalidCodeState);
  }
}

setToggleBehavior(el.toggleNewPassword, el.newPassword);
setToggleBehavior(el.toggleConfirmPassword, el.confirmPassword);

el.newPassword?.addEventListener('input', () => {
  validateForm();
});

el.confirmPassword?.addEventListener('input', () => {
  validateForm();
});

el.resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setInlineError(el.submitError, '');

  const { valid, newPasswordValue } = validateForm();
  if (!valid || !oobCode) return;

  if (el.submitBtn) {
    el.submitBtn.disabled = true;
    el.submitBtn.textContent = 'Updating...';
  }

  try {
    await confirmPasswordReset(auth, oobCode, newPasswordValue);
    hide(el.resetForm);
    show(el.successState);

    if (continueUrl && el.continueLink) {
      el.continueLink.href = continueUrl;
      show(el.continueLink);
    }
  } catch (error) {
    setInlineError(el.submitError, formatResetError(error));
  } finally {
    if (el.submitBtn) {
      el.submitBtn.disabled = false;
      el.submitBtn.textContent = 'Update Password';
    }
  }
});

initResetFlow();
