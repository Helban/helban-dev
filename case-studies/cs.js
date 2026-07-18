// Subpages (case studies, privacy policy): mobile nav only.
// Language is decided by the URL, not by this script: /... is Polish, /en/... is
// English, and build/build_en.py bakes the English text into real files. The
// language switcher is a pair of links, so it needs no JavaScript at all.
"use strict";

(() => {
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("nav");
  if (!navToggle || !navMenu) return;

  navToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navMenu.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
})();
