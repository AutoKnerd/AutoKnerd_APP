(function () {
  const MODAL_ID = 'autodrive-dealership-lead-modal';
  const BOOKING_URL = 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ1QqFX9I2PJNN13gRWTejU9duv2P2T4jC-HtnWCjdR0LoF_0XKMptjkTEGpobFkPUWt_eu_uIE9?gv=true';
  const LEGACY_LINK_PATTERNS = [
    '#dealership-implementation',
    'calendar.app.google/QWRXFH9k24iZnBZWA',
    'calendar.app.google/2gZsELsJfGXFUYDq5',
    'calendar.google.com/calendar/appointments/schedules/AcZssZ1QqFX9I2PJNN13gRWTejU9duv2P2T4jC-HtnWCjdR0LoF_0XKMptjkTEGpobFkPUWt_eu_uIE9',
  ];

  function buildModal() {
    if (document.getElementById(MODAL_ID)) {
      return document.getElementById(MODAL_ID);
    }

    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.className = 'autodrive-lead-modal-root';
    root.innerHTML = [
      '<div class="autodrive-lead-modal-backdrop"></div>',
      '<div class="autodrive-lead-modal-shell">',
      '<div class="autodrive-lead-modal-card">',
      '<button type="button" class="autodrive-lead-modal-close" aria-label="Close lead dialog">×</button>',
      '<div class="autodrive-lead-modal-panel" data-step="form">',
      '<h2 class="autodrive-lead-modal-title">Deploy The <span class="accent">AutoKnerd CX System</span> in your Dealership</h2>',
      '<p class="autodrive-lead-modal-description">Tell us a bit about your store and we\'ll show you exactly how this works for you.</p>',
      '<form class="autodrive-lead-modal-form">',
      '<div class="autodrive-lead-field"><label for="autodrive-lead-name">Name</label><input id="autodrive-lead-name" name="name" type="text" required /></div>',
      '<div class="autodrive-lead-field"><label for="autodrive-lead-email">Email</label><input id="autodrive-lead-email" name="email" type="email" required /></div>',
      '<div class="autodrive-lead-field"><label for="autodrive-lead-dealership">Dealership Name</label><input id="autodrive-lead-dealership" name="dealershipName" type="text" required /></div>',
      '<div class="autodrive-lead-field"><label for="autodrive-lead-role">Role</label><select id="autodrive-lead-role" name="role" required><option value="">Select your role</option><option value="Sales">Sales</option><option value="Manager">Manager</option><option value="Fixed Ops">Fixed Ops</option><option value="Owner">Owner</option><option value="Other">Other</option></select></div>',
      '<button type="submit" class="autodrive-lead-submit">Continue</button>',
      '</form>',
      '</div>',
      '<div class="autodrive-lead-modal-panel" data-step="schedule" hidden>',
      '<div class="autodrive-lead-schedule">',
      '<div class="autodrive-lead-schedule-hero">',
      '<p class="autodrive-lead-schedule-kicker">AutoKnerd Scheduling</p>',
      '<h3 class="autodrive-lead-schedule-title">Book Your AutoKnerd Walkthrough</h3>',
      '<p class="autodrive-lead-schedule-description">Choose a time that works for your dealership. We\'ll use the details you submitted to tailor the walkthrough to your store, team structure, and rollout needs.</p>',
      '</div>',
      '<div class="autodrive-lead-schedule-note">If the embedded calendar doesn\'t load cleanly on your device, you can <a href="' + BOOKING_URL + '" target="_blank" rel="noreferrer">open the scheduler in a new tab</a>.</div>',
      '<div class="autodrive-lead-schedule-frame"><iframe src="' + BOOKING_URL + '" title="Book an AutoKnerd walkthrough"></iframe></div>',
      '</div>',
      '</div>',
      '</div>',
      '</div>',
    ].join('');

    document.body.appendChild(root);
    return root;
  }

  function setStep(root, step) {
    var panels = root.querySelectorAll('[data-step]');
    panels.forEach(function (panel) {
      var isTarget = panel.getAttribute('data-step') === step;
      panel.hidden = !isTarget;
    });
  }

  function closeModal() {
    var root = document.getElementById(MODAL_ID);
    if (!root) return;
    root.classList.remove('is-open');
    document.body.style.overflow = '';
    setStep(root, 'form');
    var form = root.querySelector('form');
    if (form instanceof HTMLFormElement) {
      form.reset();
    }
  }

  function openModal() {
    var root = buildModal();
    root.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setStep(root, 'form');
  }

  function matchesLegacyLink(anchor) {
    var href = anchor.getAttribute('href') || '';
    var text = (anchor.textContent || '').trim().toLowerCase();
    if (LEGACY_LINK_PATTERNS.some(function (pattern) { return href.indexOf(pattern) !== -1; })) {
      return true;
    }
    return text === 'schedule dealership implementation' || text === 'schedule implementation call';
  }

  function install() {
    var root = buildModal();
    var backdrop = root.querySelector('.autodrive-lead-modal-backdrop');
    var close = root.querySelector('.autodrive-lead-modal-close');
    var form = root.querySelector('form');

    if (backdrop instanceof HTMLElement) {
      backdrop.addEventListener('click', closeModal);
    }

    if (close instanceof HTMLButtonElement) {
      close.addEventListener('click', closeModal);
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeModal();
      }
    });

    if (form instanceof HTMLFormElement) {
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var submit = form.querySelector('.autodrive-lead-submit');
        if (!(submit instanceof HTMLButtonElement)) return;

        var payload = {
          name: form.name.value,
          email: form.email.value,
          dealershipName: form.dealershipName.value,
          role: form.role.value,
        };

        submit.disabled = true;
        submit.textContent = 'Saving...';

        try {
          var response = await fetch('/api/autoforge/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          var result = null;
          try {
            result = await response.json();
          } catch (error) {}

          if (!response.ok) {
            throw new Error((result && result.error) || 'Unable to save your request.');
          }

          window.sessionStorage.setItem('autoforgeLead', JSON.stringify(payload));
          setStep(root, 'schedule');
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'Unable to save your request.');
        } finally {
          submit.disabled = false;
          submit.textContent = 'Continue';
        }
      });
    }

    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var anchor = target.closest('a');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!matchesLegacyLink(anchor)) return;
      event.preventDefault();
      openModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
