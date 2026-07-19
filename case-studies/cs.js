// Subpages (case studies, privacy policy): mobile nav only.
// Language is decided by the URL, not by this script: /... is Polish, /en/... is
// English, and build/build_en.py bakes the English text into real files. The
// language switcher is a pair of links, so it needs no JavaScript at all.
"use strict";

(() => {
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("nav");
  if (!navToggle || !navMenu) return;

  // nav-locked carries both the scroll lock and the scrim behind the panel; the
  // rules live in build/css/shell.css, shared with the home page.
  const closeMobileNav = () => {
    navMenu.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-locked");
  };

  navToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("nav-locked", isOpen);
  });

  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMobileNav);
  });

  document.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Escape" && navMenu.classList.contains("open")) {
      closeMobileNav();
      navToggle.focus();
    }
  });

  // A panel left open through a rotation would otherwise freeze the desktop layout,
  // because nav-locked is not media-scoped. This is the far side of the 880px
  // breakpoint in shell.css that turns .nav into an overlay; both have to move together.
  const ABOVE_MOBILE_NAV = "(min-width:881px)";

  window.matchMedia(ABOVE_MOBILE_NAV).addEventListener("change", (viewportChange) => {
    if (viewportChange.matches) closeMobileNav();
  });
})();
