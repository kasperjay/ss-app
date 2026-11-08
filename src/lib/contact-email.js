const { JSDOM } = require("jsdom");

function isContactEmail(value) {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9_%+\-]+(?:[.][a-z0-9_%+\-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) return false;
  const [local, domain] = email.split("@");
  if (domain === "sentry.io" || domain.endsWith(".sentry.io") || /(^|\.)sentry(?:-next)?\.wixpress\.com$/.test(domain)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|js|css|woff2?)$/.test(domain)) return false;
  if (/^(gmail|hotmail|outlook|yahoo)\.com.+/.test(domain)) return false;
  if (["example.com", "example.org", "example.net"].includes(domain)) return false;
  if (["user@domain.com", "name@company.com", "example@mysite.com"].includes(email)) return false;
  if (local === "support" && domain.endsWith(".bandcamp.com")) return false;
  return true;
}

function extractContactEmails(value) {
  if (!value) return [];
  return [...new Set((String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
    .map(email => email.toLowerCase()).filter(isContactEmail))];
}

function extractContactEmailsFromHtml(html) {
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    document.querySelectorAll("script, style, template, noscript").forEach(node => node.remove());
    const mailto = [...document.querySelectorAll('a[href]')].flatMap(node => {
      const href = node.getAttribute("href");
      if (!/^mailto:/i.test(href)) return [];
      try { return extractContactEmails(decodeURIComponent(href.slice(7).split("?")[0])); }
      catch { return []; }
    });
    const walker = document.createTreeWalker(document.body, dom.window.NodeFilter.SHOW_TEXT);
    const text = [];
    while (walker.nextNode()) text.push(walker.currentNode.textContent);
    return [...new Set([...mailto, ...extractContactEmails(text.join(" "))])];
  } finally {
    dom.window.close();
  }
}

module.exports = { isContactEmail, extractContactEmails, extractContactEmailsFromHtml };
