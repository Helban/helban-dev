// Where a lead came from, decided once per visit and carried into the contact form.
//
// The form lives on the home page, but a visitor from Google usually lands on a case
// study first and walks over from there — by then document.referrer says helban.dev and
// the real origin is gone. So every page records the FIRST touch of the session and the
// form reads that record instead of asking the browser at submit time.
//
// No cookies, no network call, no identifier: one sessionStorage entry that dies with the
// tab, and it leaves the browser only inside a message the visitor sends himself.
"use strict";

(() => {
  const DEBUG = false;
  const FIRST_TOUCH_KEY = "helbanFirstTouch";
  const CAMPAIGN_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "gclid"];
  // The value ends up in an e-mail, so a pasted tracking monster gets cut instead of
  // burying the actual message under one line of query string.
  const REFERRER_MAX_CHARS = 120;
  const DIRECT_ENTRY = "wejście bezpośrednie";

  // Private windows and "block site data" throw on the accessor itself instead of
  // returning null. A missing provenance is worth far less than a lost lead, so every
  // storage failure degrades to "describe the page I am on" and nothing else breaks.
  const readFirstTouch = () => {
    try {
      const stored = sessionStorage.getItem(FIRST_TOUCH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (storageError) {
      if (DEBUG) console.warn("sessionStorage unavailable:", storageError);
      return null;
    }
  };

  const writeFirstTouch = (firstTouch) => {
    try {
      sessionStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(firstTouch));
    } catch (storageError) {
      // The form falls back to the current page, which is still true, just less useful
      // than the entry page would have been.
      if (DEBUG) console.warn("sessionStorage unavailable:", storageError);
    }
  };

  // An internal referrer says nothing about the origin of the visit, and treating one as
  // a source is exactly how a Google visit turns into "came from helban.dev".
  const externalReferrer = () => {
    if (!document.referrer) return "";
    try {
      const referrerUrl = new URL(document.referrer);
      if (referrerUrl.host === window.location.host) return "";
      const readable = `${referrerUrl.host}${referrerUrl.pathname}`.replace(/\/$/, "");
      return readable.slice(0, REFERRER_MAX_CHARS);
    } catch (malformedReferrer) {
      if (DEBUG) console.warn("unparsable referrer:", document.referrer, malformedReferrer);
      return "";
    }
  };

  const campaignTags = () => {
    const params = new URLSearchParams(window.location.search);
    return CAMPAIGN_PARAMS
      .filter((param) => params.get(param))
      .map((param) => `${param}=${params.get(param)}`)
      .join(", ");
  };

  const currentTouch = () => ({
    referrer: externalReferrer(),
    landing: window.location.pathname,
    campaign: campaignTags(),
  });

  const describe = (touch) => {
    const origin = touch.referrer || DIRECT_ENTRY;
    const campaign = touch.campaign ? ` (${touch.campaign})` : "";
    return `${origin} → ${touch.landing}${campaign}`;
  };

  const storedTouch = readFirstTouch();
  const firstTouch = storedTouch || currentTouch();
  if (!storedTouch) writeFirstTouch(firstTouch);

  // Subpages only record; the field exists on the page that carries the form.
  const sourceField = document.getElementById("fSource");
  if (sourceField) sourceField.value = describe(firstTouch);
})();
