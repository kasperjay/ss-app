"use client";

import React, { useEffect, useRef, useCallback } from "react";

// Curated artist-feeling Google Fonts with personality
// We pick based on a hash of the artist name/genre
const ARTIST_FONTS_POOL = [
    { name: "Bebas Neue", category: "display" },
    { name: "Playfair Display", category: "serif" },
    { name: "Montserrat", category: "sans" },
    { name: "Raleway", category: "sans" },
    { name: "Oswald", category: "display" },
    { name: "Abril Fatface", category: "display" },
    { name: "Cinzel", category: "serif" },
    { name: "Josefin Sans", category: "sans" },
    { name: "Exo 2", category: "sans" },
    { name: "Righteous", category: "display" },
    { name: "Teko", category: "display" },
    { name: "Orbitron", category: "tech" },
    { name: "Rajdhani", category: "tech" },
    { name: "Rubik", category: "sans" },
    { name: "Nunito", category: "sans" },
    { name: "Cormorant Garamond", category: "serif" },
    { name: "DM Serif Display", category: "serif" },
    { name: "Unbounded", category: "display" },
    { name: "Space Grotesk", category: "sans" },
    { name: "Syne", category: "display" },
];

function stringHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

function pickFont(artistName: string, genre: string | null | undefined) {
    const seed = `${artistName}${genre ?? ""}`;
    const idx = stringHash(seed) % ARTIST_FONTS_POOL.length;
    return ARTIST_FONTS_POOL[idx];
}

interface RGB { r: number; g: number; b: number }

function rgbToHex({ r, g, b }: RGB) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): RGB | null {
    const cleaned = hex.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
    return {
        r: parseInt(cleaned.slice(0, 2), 16),
        g: parseInt(cleaned.slice(2, 4), 16),
        b: parseInt(cleaned.slice(4, 6), 16),
    };
}

function luminance({ r, g, b }: RGB) {
    const toLinear = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function lighten({ r, g, b }: RGB, amount: number): RGB {
    return {
        r: Math.min(255, Math.round(r + (255 - r) * amount)),
        g: Math.min(255, Math.round(g + (255 - g) * amount)),
        b: Math.min(255, Math.round(b + (255 - b) * amount)),
    };
}

function darken({ r, g, b }: RGB, amount: number): RGB {
    return {
        r: Math.max(0, Math.round(r * (1 - amount))),
        g: Math.max(0, Math.round(g * (1 - amount))),
        b: Math.max(0, Math.round(b * (1 - amount))),
    };
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
    return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
    };
}

function colorDistance(a: RGB, b: RGB) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// Canvas-based palette extraction with k-means clustering
function extractPalette(imageEl: HTMLImageElement, numColors = 8): RGB[] {
    const canvas = document.createElement("canvas");
    const SIZE = 80;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];

    ctx.drawImage(imageEl, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

    const pixels: RGB[] = [];
    const step = 4;
    for (let i = 0; i < data.length; i += 4 * step) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 128) continue;
        pixels.push({ r, g, b });
    }

    if (pixels.length === 0) return [];

    const k = numColors;
    const centers: RGB[] = [];
    const step2 = Math.floor(pixels.length / k);
    for (let i = 0; i < k; i++) {
        centers.push({ ...pixels[i * step2] });
    }

    for (let iter = 0; iter < 10; iter++) {
        const clusters: RGB[][] = Array.from({ length: k }, () => []);
        for (const p of pixels) {
            let minDist = Infinity;
            let assigned = 0;
            for (let j = 0; j < k; j++) {
                const d = colorDistance(p, centers[j]);
                if (d < minDist) { minDist = d; assigned = j; }
            }
            clusters[assigned].push(p);
        }
        for (let j = 0; j < k; j++) {
            if (clusters[j].length === 0) continue;
            const avg = clusters[j].reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 });
            const len = clusters[j].length;
            centers[j] = { r: Math.round(avg.r / len), g: Math.round(avg.g / len), b: Math.round(avg.b / len) };
        }
    }

    return centers;
}

function buildTheme(palette: RGB[]) {
    const sorted = [...palette].sort((a, b) => luminance(a) - luminance(b));

    const darkest = sorted[0];
    const bg = darken(darkest, 0.35);
    const surface = lighten(bg, 0.08);
    const surfaceStrong = lighten(bg, 0.14);

    const lightest = sorted[sorted.length - 1];
    const fg = lighten(lightest, 0.65);
    const muted = mixRgb(fg, bg, 0.5);

    let accent = sorted[Math.floor(sorted.length / 2)];
    let maxSat = -1;
    for (const c of palette) {
        const max = Math.max(c.r, c.g, c.b);
        const min = Math.min(c.r, c.g, c.b);
        const sat = max === 0 ? 0 : (max - min) / max;
        if (sat > maxSat) { maxSat = sat; accent = c; }
    }

    const accentVibrant = lighten(accent, 0.2);
    const accentStrong = lighten(accent, 0.4);
    const highlight = lighten(accent, 0.55);

    const border = `rgba(${accentVibrant.r}, ${accentVibrant.g}, ${accentVibrant.b}, 0.15)`;
    const borderAccent = `rgba(${accentVibrant.r}, ${accentVibrant.g}, ${accentVibrant.b}, 0.3)`;
    const glassBase = `rgba(${surface.r}, ${surface.g}, ${surface.b}, 0.65)`;
    const glassStrong = `rgba(${surfaceStrong.r}, ${surfaceStrong.g}, ${surfaceStrong.b}, 0.85)`;

    return {
        "--background": rgbToHex(bg),
        "--foreground": rgbToHex(fg),
        "--surface": rgbToHex(surface),
        "--surface-strong": rgbToHex(surfaceStrong),
        "--surface-glass": glassBase,
        "--surface-glass-strong": glassStrong,
        "--accent": rgbToHex(accentVibrant),
        "--accent-strong": rgbToHex(accentStrong),
        "--highlight": rgbToHex(highlight),
        "--muted": rgbToHex(muted),
        "--border-subtle": border,
        "--border-accent": borderAccent,
        "--accent-secondary": rgbToHex(darken(accentVibrant, 0.15)),
        "--accent-warm": rgbToHex(lighten({ r: accentVibrant.r, g: Math.max(0, accentVibrant.g - 40), b: Math.max(0, accentVibrant.b - 80) }, 0.1)),
    };
}

interface Props {
    imageUrl: string | null;
    artistName: string;
    genre?: string | null;
    accentColors?: {
        accent?: string | null;
        accentStrong?: string | null;
        highlight?: string | null;
        secondary?: string | null;
    } | null;
    children: React.ReactNode;
}

const THEME_VARIABLES = [
    "--background",
    "--foreground",
    "--surface",
    "--surface-strong",
    "--surface-glass",
    "--surface-glass-strong",
    "--accent",
    "--accent-strong",
    "--highlight",
    "--muted",
    "--border-subtle",
    "--border-accent",
    "--accent-secondary",
    "--accent-warm",
] as const;

// Apply a set of CSS variables to a target element (defaults to document.documentElement)
function applyVars(vars: Record<string, string>, target?: HTMLElement | null) {
    const el = target || document.documentElement;
    for (const [key, val] of Object.entries(vars)) {
        el.style.setProperty(key, val);
    }
}

function captureVars(target: HTMLElement) {
    return Object.fromEntries(
        THEME_VARIABLES.map((key) => [key, target.style.getPropertyValue(key)])
    );
}

function restoreVars(target: HTMLElement, vars: Record<string, string>) {
    for (const key of THEME_VARIABLES) {
        const value = vars[key];
        if (value) target.style.setProperty(key, value);
        else target.style.removeProperty(key);
    }
}

export function DynamicThemeShell({ imageUrl, artistName, genre, accentColors, children }: Props) {
    const shellRef = useRef<HTMLDivElement>(null);
    const fontInjected = useRef(false);
    const accentsStored = useRef(false);
    const paletteApplied = useRef(false);

    const applyFont = useCallback(() => {
        if (fontInjected.current) return;
        const font = pickFont(artistName, genre);
        const fontFamily = font.name.replace(/ /g, "+");
        const id = `dynamic-artist-font-${stringHash(font.name)}`;
        if (!document.getElementById(id)) {
            const link = document.createElement("link");
            link.id = id;
            link.rel = "stylesheet";
            link.href = `https://fonts.googleapis.com/css2?family=${fontFamily}:wght@400;700;900&display=swap`;
            document.head.appendChild(link);
        }
        if (shellRef.current) {
            shellRef.current.style.setProperty("--font-display", `"${font.name}", sans-serif`);
            shellRef.current.style.setProperty("--font-sans", `"${font.name}", sans-serif`);
        }
        fontInjected.current = true;
    }, [artistName, genre]);

    const applyStoredAccents = useCallback(() => {
        if (!shellRef.current || accentsStored.current) return;
        if (!accentColors) return;
        // If palette was already extracted from the image, don't override with stored accents
        if (paletteApplied.current) return;

        const { accent, accentStrong, highlight, secondary } = accentColors;
        if (!accent && !accentStrong && !highlight) return;

        const rootVars: Record<string, string> = {};
        const shellVars: Record<string, string> = {};

        if (accent) {
            rootVars["--accent"] = accent;
            shellVars["--accent"] = accent;
        }
        if (accentStrong) {
            rootVars["--accent-strong"] = accentStrong;
            shellVars["--accent-strong"] = accentStrong;
            if (!secondary) {
                const rgb = hexToRgb(accentStrong);
                if (rgb) {
                    const darkened = darken(rgb, 0.15);
                    const hex = rgbToHex(darkened);
                    rootVars["--accent-secondary"] = hex;
                    shellVars["--accent-secondary"] = hex;
                }
            }
        }
        if (highlight) {
            rootVars["--highlight"] = highlight;
            shellVars["--highlight"] = highlight;
        }
        if (secondary) {
            rootVars["--accent-secondary"] = secondary;
            shellVars["--accent-secondary"] = secondary;
        }

        // Build background/foreground from accent — only when no image palette.
        if (accent) {
            const rgb = hexToRgb(accent);
            if (rgb) {
                const bg = darken(rgb, 0.82);
                const fg = lighten(rgb, 0.65);
                const surface = darken(rgb, 0.75);
                const bgHex = rgbToHex(bg);
                const fgHex = rgbToHex(fg);
                const surfaceHex = rgbToHex(surface);
                rootVars["--background"] = bgHex;
                rootVars["--foreground"] = fgHex;
                rootVars["--surface"] = surfaceHex;
                shellVars["--background"] = bgHex;
                shellVars["--foreground"] = fgHex;
                shellVars["--surface"] = surfaceHex;
                const glassBase = `rgba(${surface.r}, ${surface.g}, ${surface.b}, 0.65)`;
                const glassStrong = `rgba(${surface.r}, ${surface.g}, ${surface.b}, 0.85)`;
                rootVars["--surface-glass"] = glassBase;
                rootVars["--surface-glass-strong"] = glassStrong;
                shellVars["--surface-glass"] = glassBase;
                shellVars["--surface-glass-strong"] = glassStrong;
            }
        }

        // Apply to BOTH :root (so Sidebar/Navbar pick it up) and the shell container
        applyVars(rootVars);
        applyVars(shellVars, shellRef.current);

        accentsStored.current = true;
        console.log("[Shell] Applied stored accents to :root and shell:", accentColors);
    }, [accentColors]);

    useEffect(() => {
        const root = document.documentElement;
        const shell = shellRef.current;
        const rootVarsBeforeTheme = captureVars(root);
        const shellVarsBeforeTheme = shell ? captureVars(shell) : {};
        let cancelled = false;

        applyFont();
        applyStoredAccents();
        if (!imageUrl) {
            return () => {
                restoreVars(root, rootVarsBeforeTheme);
                if (shell) restoreVars(shell, shellVarsBeforeTheme);
            };
        }

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            if (cancelled) return;
            try {
                const palette = extractPalette(img);
                if (palette.length > 0) {
                    paletteApplied.current = true;
                    // Reset stored-accents flag so palette can override
                    accentsStored.current = false;
                    const theme = buildTheme(palette);
                    // Apply to :root so the ENTIRE page (Sidebar, Navbar, everything) updates
                    applyVars(theme);
                    // Also apply to shell container for scoped overrides
                    applyVars(theme, shellRef.current);
                    console.log("[Shell] Applied image palette to :root:", theme);
                }
            } catch {
                // CORS or extraction failure — stored accents already applied
                console.log("[Shell] Palette extraction failed, using stored accents");
            }
        };
        img.onerror = () => {
            if (cancelled) return;
            console.log("[Shell] Image failed to load, using stored accents");
        };
        img.src = imageUrl;

        return () => {
            cancelled = true;
            restoreVars(root, rootVarsBeforeTheme);
            if (shell) restoreVars(shell, shellVarsBeforeTheme);
        };
    }, [imageUrl, applyFont, applyStoredAccents]);

    return (
        <div
            ref={shellRef}
            className="relative min-h-screen pb-20 transition-colors duration-700"
            style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
        >
            {children}
        </div>
    );
}
