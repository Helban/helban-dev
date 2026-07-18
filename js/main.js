// helban.dev storefront behaviour: PL/EN language toggle, mobile nav,
// "order" prefill into the contact form, Web3Forms lead delivery, the hero
// live-proof terminal and a nav scrollspy. No framework, no build. Polish is
// the markup default and the form has a native action, so the page stays
// readable AND contactable with JavaScript disabled.
"use strict";

(() => {
  const DEBUG = false;

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
  const subjectField = document.getElementById("fSubject");

  // The picked package survives a refresh or an interruption within the tab.
  const persistOrder = () => {
    try {
      if (selectedOrder) {
        sessionStorage.setItem("helbanOrder", JSON.stringify(selectedOrder));
      } else {
        sessionStorage.removeItem("helbanOrder");
      }
    } catch (storageError) {
      if (DEBUG) console.warn("sessionStorage unavailable:", storageError);
    }
  };

  const restoreOrder = () => {
    try {
      const savedOrder = sessionStorage.getItem("helbanOrder");
      if (savedOrder) selectedOrder = JSON.parse(savedOrder);
    } catch (storageError) {
      if (DEBUG) console.warn("sessionStorage unavailable:", storageError);
    }
  };

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
    renderTerminal({ instant: true });
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
    // First visit with no explicit choice: follow the browser language, so an
    // English-speaking visitor is not stranded on an all-Polish page.
    const browserLanguage = (navigator.language || "pl").toLowerCase();
    return browserLanguage.startsWith("pl") ? "pl" : "en";
  };

  languageButtons.pl.addEventListener("click", () => applyLanguage("pl"));
  languageButtons.en.addEventListener("click", () => applyLanguage("en"));

  // ---------- mobile navigation ----------
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("nav");

  const closeMobileNav = () => {
    navMenu.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-locked");
  };

  navToggle.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
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
  document.addEventListener("click", (clickEvent) => {
    if (navMenu.classList.contains("open") && !navMenu.contains(clickEvent.target)) {
      closeMobileNav();
    }
  });

  // ---------- nav scrollspy ----------
  // Highlights the nav link of the section in view. The contact CTA is skipped:
  // it is styled as a button and an "active" background would fight the gradient.
  const setUpScrollspy = () => {
    if (!("IntersectionObserver" in window)) return;
    const spiedLinks = new Map();
    navMenu.querySelectorAll("a[href^='#']:not(.nav-cta)").forEach((link) => {
      const section = document.getElementById(link.getAttribute("href").slice(1));
      if (section) spiedLinks.set(section, link);
    });
    if (!spiedLinks.size) return;

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          spiedLinks.forEach((link) => {
            link.classList.remove("active");
            link.removeAttribute("aria-current");
          });
          const activeLink = spiedLinks.get(entry.target);
          activeLink.classList.add("active");
          activeLink.setAttribute("aria-current", "true");
        });
      },
      // A narrow horizontal band around the viewport's upper third decides which
      // single section counts as "current".
      { rootMargin: "-30% 0px -60% 0px" },
    );
    spiedLinks.forEach((_link, section) => sectionObserver.observe(section));
  };

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
      persistOrder();
      refreshOrderReadout();
      document.getElementById("contact").scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => nameInput.focus({ preventScroll: true }), FOCUS_AFTER_SCROLL_MS);
    });
  });

  orderClearButton.addEventListener("click", () => {
    selectedOrder = null;
    persistOrder();
    serviceField.value = "";
    priceField.value = "";
    refreshOrderReadout();
  });

  // ---------- contact form ----------
  const orderForm = document.getElementById("orderForm");
  const submitButton = document.getElementById("submitBtn");
  const formStatus = document.getElementById("formStatus");
  const requiredFields = Array.from(orderForm.querySelectorAll("input[required], textarea[required]"));

  // JS handles validation with localized messages; the native bubbles follow the
  // BROWSER locale, so a Polish page could pop English prompts. Without JS the
  // attribute is absent and native validation still guards the plain POST.
  orderForm.noValidate = true;

  const showStatus = (stateKey, kind) => {
    formStatus.textContent = STATUS_TEXT[stateKey][activeLanguage];
    formStatus.className = `form-status ${kind}`;
  };

  const markInvalidFields = () => {
    requiredFields.forEach((field) => {
      const fieldValid = field.checkValidity();
      field.classList.toggle("invalid", !fieldValid);
      field.setAttribute("aria-invalid", String(!fieldValid));
    });
  };

  const findFirstInvalidField = () => requiredFields.find((field) => !field.checkValidity());

  requiredFields.forEach((field) => {
    field.addEventListener("input", () => {
      if (field.checkValidity()) {
        field.classList.remove("invalid");
        field.setAttribute("aria-invalid", "false");
      }
    });
  });

  orderForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();

    // Honeypot: real users never fill the off-screen botcheck field.
    if (orderForm.elements.botcheck.value) return;

    if (!orderForm.checkValidity()) {
      showStatus("incomplete", "err");
      markInvalidFields();
      const firstInvalidField = findFirstInvalidField();
      if (firstInvalidField) firstInvalidField.focus();
      return;
    }

    subjectField.value = `helban.dev: ${serviceField.value || "zapytanie"}`;
    const submission = new FormData(orderForm);

    submitButton.disabled = true;
    showStatus("sending", "");

    try {
      const apiResponse = await fetch(orderForm.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: submission,
      });
      const apiResult = await apiResponse.json();
      if (apiResult.success) {
        showStatus("sent", "ok");
        orderForm.reset();
        selectedOrder = null;
        persistOrder();
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

  // ---------- hero live-proof terminal ----------
  // Types real measurements of THIS page load. Backs the hero claim with the
  // visitor's own numbers instead of a marketing figure; nothing is hardcoded.
  const heroTerminal = document.getElementById("heroTerm");
  const TYPE_INTERVAL_MS = 14;
  const TERMINAL_SETTLE_MS = 350;
  // Below this little transferred, the visit clearly came from the browser cache.
  const CACHED_VISIT_MAX_BYTES = 10 * 1024;

  const prefersReducedMotion =
    !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Buffered LCP lands asynchronously; keep the latest value until render time.
  let observedLcpMs = 0;
  try {
    const lcpObserver = new PerformanceObserver((entryList) => {
      const lcpEntries = entryList.getEntries();
      if (lcpEntries.length) observedLcpMs = lcpEntries[lcpEntries.length - 1].startTime;
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch (observerError) {
    if (DEBUG) console.warn("LCP observer unavailable:", observerError);
  }

  const measureTransfer = () => {
    const navigationEntry = performance.getEntriesByType("navigation")[0];
    let totalBytes = navigationEntry ? navigationEntry.transferSize || 0 : 0;
    let fontBytes = 0;
    performance.getEntriesByType("resource").forEach((resourceEntry) => {
      totalBytes += resourceEntry.transferSize || 0;
      if (resourceEntry.name.includes("/fonts/")) fontBytes += resourceEntry.transferSize || 0;
    });
    return { totalBytes, fontBytes };
  };

  const pickLoadMomentMs = () => {
    if (observedLcpMs) return observedLcpMs;
    // Safari/Firefox have no LCP entry; first-contentful-paint is the honest stand-in.
    const paintEntry = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    if (paintEntry) return paintEntry.startTime;
    const navigationEntry = performance.getEntriesByType("navigation")[0];
    return navigationEntry ? navigationEntry.domContentLoadedEventEnd : 0;
  };

  const formatKb = (bytes) => {
    const kb = (bytes / 1024).toFixed(1);
    return activeLanguage === "pl" ? `${kb.replace(".", ",")} KB` : `${kb} KB`;
  };

  const formatSeconds = (milliseconds) => {
    const seconds = (milliseconds / 1000).toFixed(2);
    return activeLanguage === "pl" ? `${seconds.replace(".", ",")} s` : `${seconds} s`;
  };

  let terminalMeasurements = null;

  const terminalLines = () => {
    const { totalBytes, fontBytes } = terminalMeasurements.transfer;
    const loadMomentMs = terminalMeasurements.loadMomentMs;
    const fromCache = totalBytes < CACHED_VISIT_MAX_BYTES;
    if (activeLanguage === "pl") {
      return [
        fromCache
          ? `ta strona: ${formatKb(totalBytes)}, reszta z cache`
          : `ta strona, przesłane teraz: ${formatKb(totalBytes)}`,
        `${loadMomentMs ? `wczytana w ${formatSeconds(loadMomentMs)} · ` : ""}fonty: ${formatKb(fontBytes)}`,
        "zmierzone u Ciebie, a nie obiecane",
      ];
    }
    return [
      fromCache
        ? `this page: ${formatKb(totalBytes)}, rest from cache`
        : `this page, transferred now: ${formatKb(totalBytes)}`,
      `${loadMomentMs ? `loaded in ${formatSeconds(loadMomentMs)} · ` : ""}fonts: ${formatKb(fontBytes)}`,
      "measured on your device, not promised",
    ];
  };

  const buildTerminalLine = (lineText) => {
    const lineElement = document.createElement("span");
    lineElement.className = "ln";
    const promptElement = document.createElement("span");
    promptElement.className = "pr";
    promptElement.textContent = "> ";
    lineElement.appendChild(promptElement);
    lineElement.appendChild(document.createTextNode(lineText));
    return lineElement;
  };

  const appendCaret = () => {
    const caretElement = document.createElement("span");
    caretElement.className = "caret";
    heroTerminal.lastElementChild.appendChild(caretElement);
  };

  const renderTerminal = ({ instant }) => {
    if (!heroTerminal || !terminalMeasurements) return;
    heroTerminal.textContent = "";
    const lines = terminalLines();

    if (instant || prefersReducedMotion) {
      lines.forEach((lineText) => heroTerminal.appendChild(buildTerminalLine(lineText)));
      appendCaret();
      return;
    }

    let lineIndex = 0;
    let charIndex = 0;
    let currentTextNode = null;
    const typeNextChar = () => {
      if (lineIndex >= lines.length) {
        appendCaret();
        return;
      }
      if (charIndex === 0) {
        const lineElement = buildTerminalLine("");
        currentTextNode = lineElement.lastChild;
        heroTerminal.appendChild(lineElement);
      }
      currentTextNode.textContent += lines[lineIndex][charIndex];
      charIndex += 1;
      if (charIndex >= lines[lineIndex].length) {
        lineIndex += 1;
        charIndex = 0;
      }
      window.setTimeout(typeNextChar, TYPE_INTERVAL_MS);
    };
    typeNextChar();
  };

  const startTerminal = () => {
    if (!heroTerminal) return;
    // Wait for the load event plus a beat, so transfer sizes and LCP have settled.
    const measureAndRender = () => {
      window.setTimeout(() => {
        terminalMeasurements = {
          transfer: measureTransfer(),
          loadMomentMs: pickLoadMomentMs(),
        };
        renderTerminal({ instant: false });
      }, TERMINAL_SETTLE_MS);
    };
    if (document.readyState === "complete") {
      measureAndRender();
    } else {
      window.addEventListener("load", measureAndRender, { once: true });
    }
  };

  // ---------- scroll-triggered reveals: chart draw + thumbnail motifs ----------
  // Pure enhancement. If it never runs (JS off, reduced motion, or no
  // IntersectionObserver) the proof cards keep their final static chart.
  // A card starts its reveal once this fraction of it has scrolled into view.
  const CARD_REVEAL_FRACTION = 0.3;
  const proofCards = document.querySelectorAll(".proof");

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
  restoreOrder();
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
  setUpScrollspy();
  startTerminal();
})();
