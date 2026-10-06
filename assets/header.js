if (!customElements.get('mobile-drawer')) {
  class MobileDrawer extends HTMLElement {
    connectedCallback() {
      this.panel = this.querySelector('[data-drawer-panel]');
      this.overlay = this.querySelector('[data-drawer-overlay]');
      this.desktopMenus = [...this.querySelectorAll('[data-desktop-menu]')];
      this.onDesktopClick = event => {
        const toggle = event.target.closest('[data-desktop-menu-toggle]');
        if (toggle && this.contains(toggle)) {
          const menu = toggle.closest('[data-desktop-menu]');
          this.setDesktopMenu(this.activeDesktopMenu === menu ? null : menu);
        } else if (!this.querySelector('.header-desktop-nav')?.contains(event.target) || event.target.closest('a')) {
          this.setDesktopMenu(null);
        }
      };
      this.onDesktopKey = event => {
        const toggle = event.target.closest('[data-desktop-menu-toggle]');
        if (toggle && event.key === 'ArrowDown') {
          event.preventDefault();
          this.setDesktopMenu(toggle.closest('[data-desktop-menu]'));
          this.activeDesktopMenu.querySelector('[data-desktop-menu-panel] a')?.focus();
        }
        if (event.key === 'Escape' && this.activeDesktopMenu) {
          const opener = this.activeDesktopMenu.querySelector('[data-desktop-menu-toggle]');
          this.setDesktopMenu(null);
          opener.focus();
        }
      };
      this.onDesktopFocus = event => {
        if (!this.querySelector('.header-desktop-nav')?.contains(event.target)) this.setDesktopMenu(null);
      };
      this.onDesktopEnter = event => {
        if (window.innerWidth < 1024 || event.pointerType !== 'mouse') return;
        this.setDesktopMenu(event.currentTarget);
      };
      this.onDesktopLeave = event => {
        if (event.pointerType !== 'mouse') return;
        window.clearTimeout(this.desktopCloseTimer);
        this.desktopCloseTimer = window.setTimeout(() => this.setDesktopMenu(null), 180);
      };
      this.desktopMenus.forEach(menu => {
        menu.addEventListener('pointerenter', this.onDesktopEnter);
        menu.addEventListener('pointerleave', this.onDesktopLeave);
      });
      document.addEventListener('click', this.onDesktopClick);
      document.addEventListener('keydown', this.onDesktopKey);
      document.addEventListener('focusin', this.onDesktopFocus);
      this.lastY = Math.max(0, window.scrollY);
      this.toggleAttribute('data-scrolled', this.lastY > 32);
      this.onScroll = () => {
        const y = Math.max(0, window.scrollY);
        if (this.classList.contains('is-open') || this.activeDesktopMenu || document.documentElement.style.overflow === 'hidden') {
          this.lastY = y;
          return;
        }
        this.toggleAttribute('data-scrolled', y > 32);
        if (y <= 32) this.removeAttribute('data-scroll-down');
        else if (Math.abs(y - this.lastY) >= 4) this.toggleAttribute('data-scroll-down', y > this.lastY);
        if (Math.abs(y - this.lastY) >= 4 || y <= 32) this.lastY = y;
      };
      this.onClick = (event) => {
        const opener = event.target.closest('[data-drawer-open]');
        if (opener && this.contains(opener)) {
          this.classList.contains('is-open') ? this.close() : this.open(opener);
        } else if (event.target.closest('[data-drawer-close], [data-drawer-overlay]')) this.close();
        else if (this.classList.contains('is-open') && event.target.closest('a, [data-search-open], [data-cart-drawer-open]')) this.close();
      };
      this.onKey = (event) => {
        if (event.key === 'Escape' && this.classList.contains('is-open')) this.close();
      };
      this.onResize = () => {
        this.setDesktopMenu(null);
        if (this.classList.contains('is-open')) this.close();
      };
      this.onFocus = () => this.removeAttribute('data-scroll-down');
      this.addEventListener('click', this.onClick, true);
      this.addEventListener('focusin', this.onFocus);
      window.addEventListener('scroll', this.onScroll, {passive: true});
      window.addEventListener('resize', this.onResize);
      document.addEventListener('keydown', this.onKey);
    }

    disconnectedCallback() {
      this.setDesktopMenu(null);
      this.desktopMenus.forEach(menu => {
        menu.removeEventListener('pointerenter', this.onDesktopEnter);
        menu.removeEventListener('pointerleave', this.onDesktopLeave);
      });
      document.removeEventListener('click', this.onDesktopClick);
      document.removeEventListener('keydown', this.onDesktopKey);
      document.removeEventListener('focusin', this.onDesktopFocus);
      if (this.classList.contains('is-open')) this.close();
      this.removeEventListener('click', this.onClick, true);
      this.removeEventListener('focusin', this.onFocus);
      window.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('resize', this.onResize);
      document.removeEventListener('keydown', this.onKey);
    }

    setDesktopMenu(menu) {
      // No-op close: when no menu is open, closing must not touch the
      // scroll-hide state — clicks/focus elsewhere on the page (gallery
      // arrows, thumbnails, form controls) funnel through here.
      if (menu === null && !this.activeDesktopMenu) return;
      window.clearTimeout(this.desktopCloseTimer);
      this.activeDesktopMenu = menu;
      this.toggleAttribute('data-desktop-open', !!menu);
      this.removeAttribute('data-scroll-down');
      this.toggleAttribute('data-scrolled', Math.max(0, window.scrollY) > 32);
      this.desktopMenus.forEach(item => {
        item.querySelector('[data-desktop-menu-toggle]').setAttribute('aria-expanded', String(item === menu));
        item.querySelector('[data-desktop-menu-panel]').hidden = item !== menu;
      });
    }

    open(opener) {
      if (!this.panel || this.classList.contains('is-open')) return;
      this.panel.inert = false;
      this.classList.add('is-open');
      this.removeAttribute('data-scroll-down');
      this.panel.classList.remove('-translate-x-full', 'invisible');
      this.overlay?.classList.remove('opacity-0', 'invisible');
      this.querySelectorAll('[data-drawer-open]').forEach(button => button.setAttribute('aria-expanded', 'true'));
      const group = opener?.dataset.menuIndex;
      this.panel.querySelectorAll('[data-menu-group]').forEach(details => { details.open = details.dataset.menuGroup === group; });
      this.previousOverflow = document.documentElement.style.overflow;
      window.theme.lockScroll(true);
      this.focusScope = window.innerWidth >= 1024 ? this.panel : this;
      window.theme.trapFocus(this.focusScope, true);
    }

    close() {
      if (!this.classList.contains('is-open')) return;
      this.classList.remove('is-open');
      this.panel.classList.add('-translate-x-full', 'invisible');
      this.panel.inert = true;
      this.overlay?.classList.add('opacity-0', 'invisible');
      document.documentElement.style.overflow = this.previousOverflow || '';
      this.querySelectorAll('[data-drawer-open]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      window.theme.trapFocus(this.focusScope, false);
      this.lastY = Math.max(0, window.scrollY);
      this.toggleAttribute('data-scrolled', this.lastY > 32);
    }
  }
  customElements.define('mobile-drawer', MobileDrawer);
}
