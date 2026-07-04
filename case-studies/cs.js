// Subpages (case studies, privacy policy): PL/EN language toggle + mobile nav.
// No order form here, so this is a slim cousin of the hub's main.js. Polish is the markup default,
// English lives in data-en, and the choice is shared with the hub via localStorage.
"use strict";

(() => {
  const DEBUG = false;

  const langButtons = {
    pl: document.getElementById("langPl"),
    en: document.getElementById("langEn"),
  };

  // Snapshot the Polish defaults so switching back from EN restores them.
  const polishText = new Map();
  document.querySelectorAll("[data-en]").forEach((node) => {
    polishText.set(node, node.textContent);
  });

  let activeLanguage = "pl";

  const applyLanguage = (language) => {
    const useEnglish = language === "en";
    activeLanguage = useEnglish ? "en" : "pl";

    document.querySelectorAll("[data-en]").forEach((node) => {
      node.textContent = useEnglish ? node.dataset.en : polishText.get(node);
    });

    document.documentElement.lang = activeLanguage;
    if (langButtons.pl) langButtons.pl.setAttribute("aria-pressed", String(!useEnglish));
    if (langButtons.en) langButtons.en.setAttribute("aria-pressed", String(useEnglish));

    try {
      localStorage.setItem("helbanLang", activeLanguage);
    } catch (storageError) {
      if (DEBUG) console.warn("localStorage unavailable:", storageError);
    }
  };

  const pickInitialLanguage = () => {
    const queryLang = new URLSearchParams(window.location.search).get("lang");
    if (queryLang === "en" || queryLang === "pl") return queryLang;
    try {
      const storedLang = localStorage.getItem("helbanLang");
      if (storedLang === "en" || storedLang === "pl") return storedLang;
    } catch (storageError) {
      if (DEBUG) console.warn("localStorage unavailable:", storageError);
    }
    return "pl";
  };

  if (langButtons.pl) langButtons.pl.addEventListener("click", () => applyLanguage("pl"));
  if (langButtons.en) langButtons.en.addEventListener("click", () => applyLanguage("en"));

  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("nav");
  if (navToggle && navMenu) {
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
  }

  applyLanguage(pickInitialLanguage());
})();
