// helban.dev storefront behaviour: PL/EN language toggle, mobile nav,
// "order" prefill into the contact form, and Web3Forms lead delivery.
// No framework, no build. Polish is the markup default so the page is
// fully readable with JavaScript disabled.
"use strict";

(() => {
  const DEBUG = false;

  // Web3Forms public access key (safe in client-side code). Delivers leads to the
  // email the key is tied to. If it ever reverts to the placeholder, the form falls
  // back to pointing at the contact address instead of failing silently.
  const WEB3FORMS_ACCESS_KEY = "52aa9b5b-27a0-4842-9dbf-0e384294bd0f";
  const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

  // Written into the contact link at runtime so it is never a raw pattern in the
  // served HTML, which would make Cloudflare inject its render-blocking decode script.
  const CONTACT_EMAIL = "contact@helban.dev";

  // Smooth-scroll lands first, then focus, so the field is in view when focused.
  const FOCUS_AFTER_SCROLL_MS = 420;

  // UI language maps to the platform that will issue the contract, written into
  // a hidden form field so the lead email already says where to bill.
  const PLATFORM_BY_LANGUAGE = { pl: "Useme", en: "Upwork" };

  const STATUS_TEXT = {
    sending: { pl: "Wysyłam…", en: "Sending…" },
    sent: {
      pl: "Dzięki, wiadomość poszła. Odezwę się wkrótce.",
      en: "Thanks, your message is in. I'll get back to you soon.",
    },
    failed: {
      pl: `Nie udało się wysłać. Napisz bezpośrednio na ${CONTACT_EMAIL}.`,
      en: `Sending failed. Please email me directly at ${CONTACT_EMAIL}.`,
    },
    incomplete: {
      pl: "Uzupełnij imię, email i wiadomość.",
      en: "Please fill in your name, email and message.",
    },
  };

  const languageButtons = {
    pl: document.getElementById("langPl"),
    en: document.getElementById("langEn"),
  };
  const hiddenLanguageField = document.getElementById("fLang");
  const hiddenPlatformField = document.getElementById("fPlatform");

  // Snapshot the Polish defaults once, so switching back from EN restores them.
  const snapshotPolishDefaults = () => {
    const polishText = new Map();
    const polishPlaceholder = new Map();
    document.querySelectorAll("[data-en]").forEach((node) => {
      polishText.set(node, node.textContent);
    });
    document.querySelectorAll("[data-en-placeholder]").forEach((node) => {
      polishPlaceholder.set(node, node.getAttribute("placeholder") || "");
    });
    return { polishText, polishPlaceholder };
  };

  const polishDefaults = snapshotPolishDefaults();

  let activeLanguage = "pl";
  // Holds the localized labels of the service the visitor clicked "order" on.
  let selectedOrder = null;

  const orderReadout = document.getElementById("orderReadout");
  const orderNameOutput = document.getElementById("orderName");
  const orderPriceOutput = document.getElementById("orderPrice");
  const serviceField = document.getElementById("fService");
  const priceField = document.getElementById("fPrice");

  const refreshOrderReadout = () => {
    if (!selectedOrder) {
      orderReadout.classList.remove("show");
      return;
    }
    const useEnglish = activeLanguage === "en";
    const serviceLabel = useEnglish ? selectedOrder.serviceEn : selectedOrder.servicePl;
    const priceLabel = useEnglish ? selectedOrder.priceEn : selectedOrder.pricePl;
    orderNameOutput.textContent = serviceLabel;
    orderPriceOutput.textContent = priceLabel;
    serviceField.value = serviceLabel;
    priceField.value = priceLabel;
    orderReadout.classList.add("show");
  };

  // The non-text side of a language switch: active state, ARIA, hidden fields and
  // storage. Split out so the initial Polish load can sync state without the
  // full-document textContent rewrite, which forced a layout pass on every boot.
  const syncLanguageState = (language) => {
    const useEnglish = language === "en";
    activeLanguage = useEnglish ? "en" : "pl";
    document.documentElement.lang = activeLanguage;
    languageButtons.pl.setAttribute("aria-pressed", String(!useEnglish));
    languageButtons.en.setAttribute("aria-pressed", String(useEnglish));
    hiddenLanguageField.value = activeLanguage;
    hiddenPlatformField.value = PLATFORM_BY_LANGUAGE[activeLanguage];
    try {
      localStorage.setItem("helbanLang", activeLanguage);
    } catch (storageError) {
      if (DEBUG) console.warn("localStorage unavailable:", storageError);
    }
  };

  const applyLanguage = (language) => {
    const useEnglish = language === "en";

    document.querySelectorAll("[data-en]").forEach((node) => {
      node.textContent = useEnglish ? node.dataset.en : polishDefaults.polishText.get(node);
    });
    document.querySelectorAll("[data-en-placeholder]").forEach((node) => {
      node.setAttribute(
        "placeholder",
        useEnglish ? node.dataset.enPlaceholder : polishDefaults.polishPlaceholder.get(node),
      );
    });
    // Only the visible .price spans display the amount; the order buttons carry the
    // same data attributes for prefill and must keep their "Order"/"Zamów" label.
    document.querySelectorAll(".price[data-price-pl]").forEach((node) => {
      node.textContent = useEnglish ? node.dataset.priceEn : node.dataset.pricePl;
    });

    syncLanguageState(language);
    refreshOrderReadout();
  };

  const pickInitialLanguage = () => {
    const fromQuery = new URLSearchParams(window.location.search).get("lang");
    if (fromQuery === "en" || fromQuery === "pl") return fromQuery;
    try {
      const stored = localStorage.getItem("helbanLang");
      if (stored === "en" || stored === "pl") return stored;
    } catch (storageError) {
      if (DEBUG) console.warn("localStorage unavailable:", storageError);
    }
    return "pl";
  };

  languageButtons.pl.addEventListener("click", () => applyLanguage("pl"));
  languageButtons.en.addEventListener("click", () => applyLanguage("en"));

  // ---------- mobile navigation ----------
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("nav");

  const closeMobileNav = () => {
    navMenu.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  };

  navToggle.addEventListener("click", () => {
    const isOpen = navMenu.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
  navMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMobileNav);
  });

  // ---------- order prefill ----------
  const orderClearButton = document.getElementById("orderClear");
  const nameInput = document.getElementById("name");

  document.querySelectorAll(".order-btn").forEach((button) => {
    button.addEventListener("click", () => {
      selectedOrder = {
        servicePl: button.dataset.service,
        serviceEn: button.dataset.serviceEn,
        pricePl: button.dataset.pricePl,
        priceEn: button.dataset.priceEn,
      };
      refreshOrderReadout();
      document.getElementById("contact").scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => nameInput.focus({ preventScroll: true }), FOCUS_AFTER_SCROLL_MS);
    });
  });

  orderClearButton.addEventListener("click", () => {
    selectedOrder = null;
    serviceField.value = "";
    priceField.value = "";
    refreshOrderReadout();
  });

  // ---------- contact form ----------
  const orderForm = document.getElementById("orderForm");
  const submitButton = document.getElementById("submitBtn");
  const formStatus = document.getElementById("formStatus");

  const showStatus = (stateKey, kind) => {
    formStatus.textContent = STATUS_TEXT[stateKey][activeLanguage];
    formStatus.className = `form-status ${kind}`;
  };

  orderForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();

    // Honeypot: real users never fill the off-screen botcheck field.
    if (orderForm.elements.botcheck.value) return;

    if (!orderForm.checkValidity()) {
      showStatus("incomplete", "err");
      orderForm.reportValidity();
      return;
    }

    if (WEB3FORMS_ACCESS_KEY === "REPLACE_WITH_WEB3FORMS_ACCESS_KEY") {
      if (DEBUG) console.warn("Web3Forms key not set; lead delivery disabled.");
      showStatus("failed", "err");
      return;
    }

    const submission = new FormData(orderForm);
    submission.append("access_key", WEB3FORMS_ACCESS_KEY);
    submission.append("subject", `helban.dev: ${serviceField.value || "zapytanie"}`);
    submission.append("from_name", "helban.dev");

    submitButton.disabled = true;
    showStatus("sending", "");

    try {
      const apiResponse = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: submission,
      });
      const apiResult = await apiResponse.json();
      if (apiResult.success) {
        showStatus("sent", "ok");
        orderForm.reset();
        selectedOrder = null;
        refreshOrderReadout();
      } else {
        showStatus("failed", "err");
      }
    } catch (networkError) {
      if (DEBUG) console.warn("Lead submission failed:", networkError);
      showStatus("failed", "err");
    } finally {
      submitButton.disabled = false;
    }
  });

  // ---------- scroll-triggered reveals: chart draw + thumbnail motifs ----------
  // Pure enhancement. If it never runs (JS off, reduced motion, or no
  // IntersectionObserver) the proof cards keep their final static chart.
  // A card starts its reveal once this fraction of it has scrolled into view.
  const CARD_REVEAL_FRACTION = 0.3;
  const proofCards = document.querySelectorAll(".proof");
  const prefersReducedMotion =
    !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const setUpProofReveals = () => {
    if (prefersReducedMotion || !("IntersectionObserver" in window) || !proofCards.length) {
      return;
    }
    document.documentElement.classList.add("js-reveal");

    const cardObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        });
      },
      { threshold: CARD_REVEAL_FRACTION },
    );
    proofCards.forEach((card) => cardObserver.observe(card));
  };

  // ---------- boot ----------
  // Polish is the markup default, so a Polish visitor needs only the state sync on
  // load, not a full-document text rewrite. English (query or stored) does the pass.
  const initialLanguage = pickInitialLanguage();
  if (initialLanguage === "en") {
    applyLanguage("en");
  } else {
    syncLanguageState("pl");
    refreshOrderReadout();
  }

  // Assemble the contact address at runtime (see CONTACT_EMAIL); the static markup
  // carries no email pattern, so Cloudflare adds no render-blocking decode script.
  const contactEmailLink = document.getElementById("contactEmail");
  const contactEmailText = document.getElementById("contactEmailText");
  if (contactEmailLink && contactEmailText) {
    contactEmailLink.href = `mailto:${CONTACT_EMAIL}`;
    contactEmailText.textContent = CONTACT_EMAIL;
  }

  setUpProofReveals();
})();
