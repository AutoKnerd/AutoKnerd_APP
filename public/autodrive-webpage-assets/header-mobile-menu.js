(function () {
  const MENU_ID = 'autodrive-mobile-menu';
  const BUTTON_ID = 'autodrive-mobile-menu-button';

  function closeMenu() {
    const header = document.querySelector('.autodrive-marketing-header');
    if (!header) return;
    header.classList.remove('mobile-menu-open');
    document.body.classList.remove('autodrive-mobile-menu-open');
    const button = header.querySelector('#' + BUTTON_ID);
    if (button instanceof HTMLElement) {
      button.setAttribute('aria-label', 'Open navigation menu');
    }
  }

  function openMenu() {
    const header = document.querySelector('.autodrive-marketing-header');
    if (!header) return;
    header.classList.add('mobile-menu-open');
    document.body.classList.add('autodrive-mobile-menu-open');
    const button = header.querySelector('#' + BUTTON_ID);
    if (button instanceof HTMLElement) {
      button.setAttribute('aria-label', 'Close navigation menu');
    }
  }

  function toggleMenu() {
    const header = document.querySelector('.autodrive-marketing-header');
    if (!header) return;
    if (header.classList.contains('mobile-menu-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function buildMenu() {
    const header = document.querySelector('.autodrive-marketing-header');
    if (!header) return;
    if (header.querySelector('#' + BUTTON_ID)) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'autodrive-mobile-menu-trigger';
    button.setAttribute('aria-label', 'Open navigation menu');
    button.innerHTML = '<span></span><span></span><span></span>';
    button.addEventListener('click', toggleMenu);

    const panel = document.createElement('div');
    panel.id = MENU_ID;
    panel.className = 'autodrive-mobile-menu-panel';
    panel.innerHTML = [
      '<div class="autodrive-mobile-menu-backdrop"></div>',
      '<div class="autodrive-mobile-menu-inner">',
      '<div class="autodrive-mobile-menu-header">',
      '<p class="autodrive-mobile-menu-title">AutoDriveCX</p>',
      '<p class="autodrive-mobile-menu-description">Product navigation and system links</p>',
      '<button type="button" class="autodrive-mobile-menu-close" aria-label="Close navigation menu">×</button>',
      '</div>',
      '<a href="https://app.autodrivecx.com/login" class="autodrive-mobile-primary">Login</a>',
      '<div class="autodrive-mobile-links">',
      '<a href="/autodrive" class="autodrive-mobile-item">Home</a>',
      '<a href="/Autoknerd/podcast" class="autodrive-mobile-item">Podcast</a>',
      '<a href="/Autoknerd/about" class="autodrive-mobile-item">About</a>',
      '</div>',
      '<div class="autodrive-mobile-section">',
      '<p class="autodrive-mobile-label">System</p>',
      '<a href="/Autoknerd" class="autodrive-mobile-item">AutoKnerd</a>',
      '<a href="/autoshop" class="autodrive-mobile-item">AutoShop</a>',
      '<a href="/autoforge" class="autodrive-mobile-item">AutoForge</a>',
      '</div>',
      '</div>',
    ].join('');

    panel.addEventListener('click', function (event) {
      const target = event.target;
      if (target instanceof HTMLAnchorElement) {
        closeMenu();
      }
      if (target instanceof HTMLElement && target.classList.contains('autodrive-mobile-menu-backdrop')) {
        closeMenu();
      }
    });

    const closeButton = panel.querySelector('.autodrive-mobile-menu-close');
    if (closeButton instanceof HTMLButtonElement) {
      closeButton.addEventListener('click', closeMenu);
    }

    header.insertBefore(button, header.firstChild);
    header.appendChild(panel);

    document.addEventListener('click', function (event) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!header.contains(target)) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeMenu();
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) {
        closeMenu();
      }
    });
  }

  const observer = new MutationObserver(function () {
    buildMenu();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  buildMenu();
})();
