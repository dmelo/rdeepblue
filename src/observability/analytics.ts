type GtagCommand = "config" | "event" | "js" | "set";
type GtagValue = string | number | boolean | Date | Record<string, unknown> | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (command: GtagCommand, target: string | Date, config?: Record<string, GtagValue>) => void;
  }
}

const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;

export function initializeAnalytics() {
  if (!measurementId || window.gtag) {
    return;
  }

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args) => {
    window.dataLayer?.push(args);
  };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: true
  });
}

export function trackEvent(name: string, parameters: Record<string, GtagValue> = {}) {
  if (!window.gtag || !measurementId) {
    return;
  }

  window.gtag("event", name, parameters);
}
