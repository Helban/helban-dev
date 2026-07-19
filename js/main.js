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

  // Focus fires on scrollend where supported; this timer is the fallback for
  // browsers without the event and for the no-scroll case (already at the form).
  const FOCUS_FALLBACK_MS = 900;

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
    invalidEmail: {
      pl: "Popraw adres email.",
      en: "Please correct your email address.",
    },
  };

  const hiddenLanguageField = document.getElementById("fLang");
  const hiddenPlatformField = document.getElementById("fPlatform");

  // The URL decides the language, not this script: / is Polish, /en/ is English,
  // and build/build_en.py bakes the English text into the served HTML. Nothing here
  // rewrites copy any more, so the language is fixed for the life of the page.
  const activeLanguage = document.documentElement.lang === "en" ? "en" : "pl";
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

  // The lead email should already say which platform will issue the contract, and
  // that follows from the language of the page the visitor actually ordered from.
  hiddenLanguageField.value = activeLanguage;
  hiddenPlatformField.value = PLATFORM_BY_LANGUAGE[activeLanguage];

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

  // Focus enters the panel by itself (it follows the toggle in the DOM), but tabbing
  // off the last link used to escape to the page behind it, which is still scroll-locked.
  // Only the two edges are handled, so tabbing inside the panel stays untouched. The
  // toggle joins the cycle because it is the control that closes the panel again.
  const mobileNavStops = () => [navToggle, ...navMenu.querySelectorAll("a")];

  document.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key !== "Tab" || !navMenu.classList.contains("open")) return;
    const stops = mobileNavStops();
    const currentStop = stops.indexOf(document.activeElement);
    if (currentStop === -1) return;
    const leavingPanel = keyEvent.shiftKey ? currentStop === 0 : currentStop === stops.length - 1;
    if (!leavingPanel) return;
    keyEvent.preventDefault();
    stops[keyEvent.shiftKey ? stops.length - 1 : 0].focus();
  });

  // The far side of the 880px breakpoint that turns .nav into an overlay panel in CSS.
  // Both numbers describe the same threshold, so they have to move together.
  const ABOVE_MOBILE_NAV = "(min-width:881px)";

  // Widening past it turns the panel back into a plain row, but body.nav-locked is not
  // media-scoped, so a menu left open through a rotation froze the desktop layout.
  const wideViewport = window.matchMedia(ABOVE_MOBILE_NAV);
  wideViewport.addEventListener("change", (viewportChange) => {
    if (viewportChange.matches) closeMobileNav();
  });
  document.addEventListener("click", (clickEvent) => {
    if (navMenu.classList.contains("open") && !navMenu.contains(clickEvent.target)) {
      closeMobileNav();
    }
  });

  // ---------- nav scrollspy ----------
  // Highlights the nav link of the section in view. The contact CTA takes part
  // (so "O mnie" unlights at #contact and aria-current lands correctly) but its
  // .active background is suppressed in CSS to not fight the gradient.
  const setUpScrollspy = () => {
    if (!("IntersectionObserver" in window)) return;
    const spiedLinks = new Map();
    navMenu.querySelectorAll("a[href^='#']").forEach((link) => {
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

  // ---------- collapsed sections ----------
  // Two grids fold part of themselves away behind a single button: the packages and the
  // proof strip. Both have to flip their label, keep aria-expanded honest, and say out
  // loud what changed, because opening either one moves no focus for a reader to follow.
  const setDisclosureLabel = (button, isExpanded, labels) => {
    button.setAttribute("aria-expanded", String(isExpanded));
    button.textContent = labels[isExpanded ? "collapse" : "expand"][activeLanguage];
  };

  const announceInto = (region, message) => {
    if (region) region.textContent = message;
  };

  // ---------- proof strip ----------
  const proofGrid = document.getElementById("proofGrid");
  const showAllProofButton = document.getElementById("showAllProof");
  const proofAnnouncement = document.getElementById("proofAnnounce");

  const PROOF_LABEL = {
    expand: { pl: "Pokaż pozostałe realizacje", en: "Show the rest" },
    collapse: { pl: "Zwiń realizacje", en: "Show fewer" },
  };

  if (proofGrid && showAllProofButton) {
    const proofCardCount = proofGrid.querySelectorAll(".proof").length;
    const alwaysShownProofCount = proofGrid.querySelectorAll(".proof:not([data-extra])").length;

    showAllProofButton.addEventListener("click", () => {
      const isExpanded = proofGrid.classList.toggle("open");
      setDisclosureLabel(showAllProofButton, isExpanded, PROOF_LABEL);
      const shownCount = isExpanded ? proofCardCount : alwaysShownProofCount;
      // "z 7 realizacji" takes the genitive whatever the count, so this one needs no
      // plural helper.
      announceInto(
        proofAnnouncement,
        activeLanguage === "en"
          ? `Showing ${shownCount} of ${proofCardCount} projects.`
          : `Pokazuję ${shownCount} z ${proofCardCount} realizacji.`,
      );
    });
  }

  // ---------- service intent doors ----------
  // The section opens with three doors and no packages: a visible grid always
  // out-shouted the choice. Picking a door reveals the matching packages,
  // "pokaż wszystkie" reveals the lot. Without JS (no .js-collapse class on <html>)
  // the doors are inert and every package is visible from the start.
  // Four visible cards look better as 2x2 than as a row of three plus a stray.
  const FOUR_CARD_ROW = 4;

  const doorRow = document.getElementById("svcDoors");
  const doorButtons = Array.from(doorRow ? doorRow.querySelectorAll(".door") : []);
  const showAllButton = document.getElementById("showAllPackages");
  const packageGrid = document.querySelector(".svc-grid");
  const packageCards = packageGrid ? Array.from(packageGrid.querySelectorAll(".svc")) : [];
  const packageAnnouncement = document.getElementById("svcAnnounce");

  const SHOW_ALL_LABEL = {
    expand: { pl: "Pokaż wszystkie siedem pakietów", en: "Show all seven packages" },
    collapse: { pl: "Zwiń pakiety", en: "Collapse packages" },
  };

  // Polish takes three forms: 1 pakiet, 2-4 pakiety, 5+ pakietów, with the teens
  // falling back to the last form regardless of their final digit.
  const polishPackageNoun = (count) => {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;
    if (count === 1) return "pakiet";
    const isTeen = lastTwoDigits >= 12 && lastTwoDigits <= 14;
    return lastDigit >= 2 && lastDigit <= 4 && !isTeen ? "pakiety" : "pakietów";
  };

  const announcePackages = (visibleCount) => {
    if (visibleCount === 0) {
      announceInto(
        packageAnnouncement,
        activeLanguage === "en" ? "Packages hidden." : "Pakiety zwinięte.",
      );
      return;
    }
    announceInto(
      packageAnnouncement,
      activeLanguage === "en"
        ? `Showing ${visibleCount} package${visibleCount === 1 ? "" : "s"}.`
        : `Pokazuję ${visibleCount} ${polishPackageNoun(visibleCount)}.`,
    );
  };

  const setShowAllState = (isExpanded) => {
    if (!showAllButton) return;
    setDisclosureLabel(showAllButton, isExpanded, SHOW_ALL_LABEL);
  };

  const revealAllPackages = () => {
    doorButtons.forEach((doorButton) => doorButton.setAttribute("aria-pressed", "false"));
    packageCards.forEach((packageCard) => {
      packageCard.hidden = false;
    });
    doorRow.classList.remove("chosen");
    packageGrid.classList.remove("filtered", "cols-2");
    packageGrid.classList.add("open");
    setShowAllState(true);
    announcePackages(packageCards.length);
  };

  // The way back out. Without it the only exit from an opened grid was a page reload,
  // and a control that never returns to its starting state cannot honestly carry
  // aria-expanded.
  const collapsePackages = () => {
    doorButtons.forEach((doorButton) => doorButton.setAttribute("aria-pressed", "false"));
    doorRow.classList.remove("chosen");
    packageGrid.classList.remove("open", "filtered", "cols-2");
    setShowAllState(false);
    announcePackages(0);
  };

  const revealDoorPackages = (activeDoor) => {
    doorButtons.forEach((doorButton) => {
      doorButton.setAttribute("aria-pressed", String(doorButton.dataset.door === activeDoor));
    });
    let visibleCount = 0;
    packageCards.forEach((packageCard) => {
      const cardDoor = packageCard.dataset.door;
      packageCard.hidden = cardDoor !== activeDoor && cardDoor !== "any";
      if (!packageCard.hidden) visibleCount += 1;
    });
    doorRow.classList.add("chosen");
    packageGrid.classList.add("filtered", "open");
    packageGrid.classList.toggle("cols-2", visibleCount === FOUR_CARD_ROW);
    // A door narrows the grid, so the button no longer describes the state it is in.
    setShowAllState(false);
    announcePackages(visibleCount);
  };

  doorButtons.forEach((doorButton) => {
    doorButton.addEventListener("click", () => {
      revealDoorPackages(doorButton.dataset.door);
    });
  });

  if (showAllButton) {
    showAllButton.addEventListener("click", () => {
      if (showAllButton.getAttribute("aria-expanded") === "true") {
        collapsePackages();
        return;
      }
      revealAllPackages();
    });
  }

  // ---------- order prefill ----------
  const orderClearButton = document.getElementById("orderClear");
  const nameInput = document.getElementById("name");

  // A fixed timer used to fire mid-scroll, popping the mobile keyboard while the
  // page was still moving. scrollend is exact; the timer covers the rest.
  const focusWhenScrollSettles = (targetField) => {
    let alreadyFocused = false;
    const focusOnce = () => {
      if (alreadyFocused) return;
      alreadyFocused = true;
      targetField.focus({ preventScroll: true });
    };
    if ("onscrollend" in window) {
      window.addEventListener("scrollend", focusOnce, { once: true });
    }
    window.setTimeout(focusOnce, FOCUS_FALLBACK_MS);
  };

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
      // A failed submit leaves three red errors and a red status behind. Ordering a
      // package scrolls the visitor back down to that wreckage, so the form would
      // greet a fresh order by shouting about the previous one.
      clearFormValidation();
      document.getElementById("contact").scrollIntoView({ behavior: "smooth", block: "start" });
      focusWhenScrollSettles(nameInput);
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

  const fieldErrorElement = (field) => document.getElementById(`${field.id}Err`);

  // Empty field and wrong format are different mistakes; say which one it is,
  // in the page language (data-err-* attributes on the .field-err element).
  const fieldErrorText = (field) => {
    const errorData = fieldErrorElement(field).dataset;
    const useEnglish = activeLanguage === "en";
    if (field.validity.valueMissing) {
      return useEnglish ? errorData.errEn : errorData.errPl;
    }
    const invalidText = useEnglish ? errorData.errInvalidEn : errorData.errInvalidPl;
    return invalidText || (useEnglish ? errorData.errEn : errorData.errPl);
  };

  const markInvalidFields = () => {
    requiredFields.forEach((field) => {
      const fieldValid = field.checkValidity();
      field.classList.toggle("invalid", !fieldValid);
      field.setAttribute("aria-invalid", String(!fieldValid));
      const errorElement = fieldErrorElement(field);
      errorElement.textContent = fieldValid ? "" : fieldErrorText(field);
      errorElement.classList.toggle("show", !fieldValid);
    });
  };

  const findFirstInvalidField = () => requiredFields.find((field) => !field.checkValidity());

  const clearFieldError = (field) => {
    field.classList.remove("invalid");
    field.setAttribute("aria-invalid", "false");
    const errorElement = fieldErrorElement(field);
    errorElement.textContent = "";
    errorElement.classList.remove("show");
  };

  const clearFormValidation = () => {
    requiredFields.forEach(clearFieldError);
    formStatus.textContent = "";
    formStatus.className = "form-status";
  };

  requiredFields.forEach((field) => {
    field.addEventListener("input", () => {
      if (field.checkValidity()) clearFieldError(field);
    });
  });

  orderForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();

    // Honeypot: real users never fill the off-screen botcheck field.
    if (orderForm.elements.botcheck.value) return;

    if (!orderForm.checkValidity()) {
      const anyFieldEmpty = requiredFields.some((field) => field.validity.valueMissing);
      showStatus(anyFieldEmpty ? "incomplete" : "invalidEmail", "err");
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

  // transferSize is what actually crossed the wire (0 on a cached repeat visit);
  // decodedBodySize is the unpacked weight, available even when served from cache.
  const measureTransfer = () => {
    const navigationEntry = performance.getEntriesByType("navigation")[0];
    let transferredBytes = navigationEntry ? navigationEntry.transferSize || 0 : 0;
    let decodedBytes = navigationEntry ? navigationEntry.decodedBodySize || 0 : 0;
    let fontTransferredBytes = 0;
    performance.getEntriesByType("resource").forEach((resourceEntry) => {
      transferredBytes += resourceEntry.transferSize || 0;
      decodedBytes += resourceEntry.decodedBodySize || 0;
      if (resourceEntry.name.includes("/fonts/")) {
        fontTransferredBytes += resourceEntry.transferSize || 0;
      }
    });
    return { transferredBytes, decodedBytes, fontTransferredBytes };
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
    const { transferredBytes, decodedBytes, fontTransferredBytes } = terminalMeasurements.transfer;
    const loadMomentMs = terminalMeasurements.loadMomentMs;
    const usePolish = activeLanguage === "pl";

    // Repeat visit: nothing crossed the wire, the browser served its cache.
    // Say so instead of printing a broken-looking "0 KB".
    const fromCache = transferredBytes < CACHED_VISIT_MAX_BYTES && decodedBytes > CACHED_VISIT_MAX_BYTES;
    // Timing APIs unavailable or zeroed (some privacy browsers): no numbers, no claims.
    const unmeasurable = transferredBytes < CACHED_VISIT_MAX_BYTES && !fromCache;

    if (unmeasurable) {
      return usePolish
        ? [
            "ta strona: ręcznie pisany HTML, bez frameworka",
            "fonty: 6 plików, zero zapytań do Google",
            "zmierz sam: PageSpeed Insights",
          ]
        : [
            "this page: hand-written HTML, no framework",
            "fonts: 6 files, self-hosted, zero Google",
            "measure it yourself: PageSpeed Insights",
          ];
    }

    const loadPl = loadMomentMs ? `wczytana w ${formatSeconds(loadMomentMs)} · ` : "";
    const loadEn = loadMomentMs ? `loaded in ${formatSeconds(loadMomentMs)} · ` : "";
    const fontsPl = fontTransferredBytes ? `fonty: ${formatKb(fontTransferredBytes)}` : "fonty: z cache";
    const fontsEn = fontTransferredBytes ? `fonts: ${formatKb(fontTransferredBytes)}` : "fonts: cached";

    if (usePolish) {
      return [
        fromCache
          ? `ta strona: cała z cache, waży ${formatKb(decodedBytes)}`
          : `ta strona, przesłane teraz: ${formatKb(transferredBytes)}`,
        `${loadPl}${fontsPl}`,
        "zmierzone u Ciebie, a nie obiecane",
      ];
    }
    return [
      fromCache
        ? `this page: from cache, weighs ${formatKb(decodedBytes)}`
        : `this page, transferred now: ${formatKb(transferredBytes)}`,
      `${loadEn}${fontsEn}`,
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

  // ---------- scroll-triggered reveals: review ratings ----------
  // Pure enhancement. If it never runs (JS off, reduced motion, or no
  // IntersectionObserver) the ratings stay plain and visible.
  // A card starts its reveal once this fraction of it has scrolled into view.
  const CARD_REVEAL_FRACTION = 0.3;
  // Only the review cards animate on scroll. Proof thumbnails are static screenshots,
  // so widening this selector would observe seven cards that have nothing to reveal.
  const revealCards = document.querySelectorAll(".say");

  const setUpRatingReveals = () => {
    if (prefersReducedMotion || !("IntersectionObserver" in window) || !revealCards.length) {
      return;
    }
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
    // The class that hides the stars is added by the same pass that starts watching
    // for them to scroll in. A stale or missing script therefore cannot hide a rating
    // it will never reveal: the review data degrades to plain, visible stars.
    revealCards.forEach((card) => {
      card.classList.add("will-reveal");
      cardObserver.observe(card);
    });
  };

  // ---------- boot ----------
  // The served HTML is already in the right language, so boot never rewrites copy.
  restoreOrder();
  refreshOrderReadout();

  // Assemble the contact address at runtime (see CONTACT_EMAIL); the static markup
  // carries no email pattern, so Cloudflare adds no render-blocking decode script.
  const contactEmailLink = document.getElementById("contactEmail");
  const contactEmailText = document.getElementById("contactEmailText");
  if (contactEmailLink && contactEmailText) {
    contactEmailLink.href = `mailto:${CONTACT_EMAIL}`;
    contactEmailText.textContent = CONTACT_EMAIL;
  }

  setUpRatingReveals();
  setUpScrollspy();
  startTerminal();
})();
