import { isContactEmail, extractContactEmails, extractContactEmailsFromHtml } from "./contact-email";

const LINK_HUB_HOSTS = new Set([
  "linktr.ee",
  "linkin.bio",
  "beacons.ai",
  "lnk.to",
  "solo.to",
  "carrd.co",
  "bio.link",
  "fanlink.to",
  "hyperfollow.com",
]);

const SOCIAL_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "m.facebook.com",
  "www.facebook.com",
  "tiktok.com",
  "www.tiktok.com",
  "youtube.com",
  "www.youtube.com",
  "twitter.com",
  "x.com",
  "soundcloud.com",
  "open.spotify.com",
  "spotify.com",
  "music.apple.com",
]);

const normalizeUrl = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    if (!/^https?:\/\//i.test(trimmed)) {
      return new URL(`https://${trimmed}`).toString();
    }
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
};

const extractEmailsFromText = extractContactEmails;

const extractLinks = (html: string, baseUrl: string) => {
  const links = new Set<string>();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html))) {
    const raw = match[1];
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:")) continue;
    try {
      const url = new URL(raw, baseUrl);
      links.add(url.toString());
    } catch {
      // ignore
    }
  }

  return Array.from(links);
};

const isSocialHost = (url: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SOCIAL_HOSTS.has(host);
  } catch {
    return true;
  }
};

const isLinkHubHost = (url: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LINK_HUB_HOSTS.has(host);
  } catch {
    return false;
  }
};

const sameHost = (a: string, b: string) => {
  try {
    return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase();
  } catch {
    return false;
  }
};

const fetchHtml = async (url: string, timeoutMs = 6000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "spectral-soundworks-bot/1.0",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const pickContactLinks = (links: string[], baseUrl: string) => {
  const keywords = [
    "contact",
    "booking",
    "press",
    "management",
    "inquiries",
    "inquiry",
    "connect",
    "about",
  ];

  return links.filter((link) => {
    if (!sameHost(link, baseUrl)) return false;
    const path = new URL(link).pathname.toLowerCase();
    return keywords.some((keyword) => path.includes(keyword));
  });
};

const pickExternalLinks = (links: string[]) =>
  links.filter((link) => !isSocialHost(link) && !isLinkHubHost(link));

export const discoverEmailsFromUrls = async (urls: Array<string | null | undefined>) => {
  const normalized = urls
    .map((value) => normalizeUrl(value))
    .filter((value): value is string => Boolean(value));

  const emails = new Set<string>();
  const visited = new Set<string>();
  const queue = [...normalized];
  const maxPages = Number.parseInt(process.env.EMAIL_SCRAPE_MAX_PAGES || "5", 10) || 5;

  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);

    const html = await fetchHtml(url);
    if (!html) continue;

    for (const email of extractContactEmailsFromHtml(html)) {
      emails.add(email);
    }

    if (emails.size > 0) continue;

    const links = extractLinks(html, url);

    if (isLinkHubHost(url)) {
      const external = pickExternalLinks(links).slice(0, 3);
      queue.push(...external);
      continue;
    }

    const contactLinks = pickContactLinks(links, url).slice(0, 3);
    queue.push(...contactLinks);
  }

  return Array.from(emails);
};

export const mergeEmails = (...emailSets: Array<string[] | null | undefined>) => {
  const set = new Set<string>();
  for (const emails of emailSets) {
    if (!emails) continue;
    for (const email of emails) {
      const normalized = email.trim().toLowerCase();
      if (isContactEmail(normalized)) set.add(normalized);
    }
  }
  return Array.from(set);
};

export const extractEmailsFromTextSafe = (value?: string | null) =>
  extractEmailsFromText(value);
