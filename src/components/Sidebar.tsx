"use client";

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationInbox } from './NotificationInbox';

const NavIcon = ({ children, active = false }: { children: React.ReactNode, active?: boolean }) => (
  <div className={`
    h-12 w-12 rounded-[18px] flex items-center justify-center transition-all duration-300 cursor-pointer group relative
    ${active
      ? 'bg-accent text-black'
      : 'bg-white/5 text-white/40 hover:bg-accent/20 hover:text-accent hover:rounded-[14px]'}
  `}
  style={active ? { boxShadow: '0 0 20px color-mix(in srgb, var(--accent) 40%, transparent)' } : undefined}
  >
    {active && <div className="absolute -left-4 w-1 h-8 bg-accent rounded-r-full" />}
    {children}
  </div>
);

export function Sidebar({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const [isExploreOpen, setIsExploreOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const exploreLinks = useMemo(() => {
    const items = [
      { href: '/', label: 'Dashboard', description: 'Overview and recent activity' },
      { href: '/KPIs', label: 'KPIs', description: 'Outreach success and campaign analytics' },
      { href: '/leads/discover', label: 'Artist Search', description: 'Venue and Instagram discovery' },
      { href: '/leads', label: 'Leads', description: 'Central view of all leads and contacts' },
      { href: '/replies', label: 'Replies', description: 'Triage incoming artist replies' },
      { href: '/sequences', label: 'Sequences', description: 'Follow-up cadences and due drafts' },
      { href: '/projects', label: 'Projects', description: 'Manage active client work' },
      { href: '/calendar', label: 'Calendar', description: 'Upcoming sessions and bookings' },
      { href: '/operations', label: 'Operations', description: 'Follow-up queue and action items' },
    ];

    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;

    return items.filter((item) =>
      item.label.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  return (
    <aside className={`fixed left-0 top-0 bottom-0 z-50 hidden w-24 overflow-visible bg-[#0d0d12] py-8 lg:flex flex-col items-center gap-10 ${className}`}>
      {/* Logo */}
      <Link href="/" className="group relative">
        <div className="h-14 w-14 rounded-[22px] bg-linear-to-br from-accent to-accent-secondary flex items-center justify-center font-bold text-black shadow-2xl transition-transform group-hover:scale-110">
           S
        </div>
      </Link>

      {/* Main Nav */}
      <nav className="flex flex-col gap-6 items-center flex-1">
        <Link href="/">
          <NavIcon active={pathname === '/'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </NavIcon>
        </Link>
        <Link href="/leads/discover">
          <NavIcon active={pathname?.startsWith('/leads/discover') || false}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2 2"/><path d="m7.8 16.2 2-2"/><path d="m14.5 14.5 2 2"/><path d="m9.5 9.5-2-2"/><path d="m18.3 12-2.3 0"/><path d="m5.7 12 2.3 0"/><path d="m12 5.7 0 2.3"/><path d="m12 18.3 0 2.3"/></svg>
          </NavIcon>
        </Link>
        <Link href="/leads">
          <NavIcon active={pathname === '/leads' || (pathname?.startsWith('/leads') && !pathname?.startsWith('/leads/discover'))}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>
          </NavIcon>
        </Link>
        <Link href="/projects">
          <NavIcon active={pathname?.startsWith('/projects') || false}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          </NavIcon>
        </Link>
        <Link href="/calendar">
          <NavIcon active={pathname?.startsWith('/calendar') || false}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </NavIcon>
        </Link>
        <Link href="/replies">
          <NavIcon active={pathname?.startsWith('/replies') || false}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </NavIcon>
        </Link>
        <Link href="/sequences">
          <NavIcon active={pathname?.startsWith('/sequences') || false}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          </NavIcon>
        </Link>

        <div className="relative">
          <button
            type="button"
            aria-label="Open explore"
            onClick={() => setIsExploreOpen((open) => !open)}
            className={`h-12 w-12 rounded-[18px] flex items-center justify-center transition-all duration-300 cursor-pointer group relative ${isExploreOpen ? 'bg-accent text-black' : 'bg-white/5 text-white/40 hover:bg-accent/20 hover:text-accent hover:rounded-[14px]'}`}
            style={isExploreOpen ? { boxShadow: '0 0 20px color-mix(in srgb, var(--accent) 40%, transparent)' } : undefined}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          </button>

          {isExploreOpen && (
            <div className="absolute left-[calc(100%+20px)] top-1/2 z-50 w-96 -translate-y-1/2 rounded-[32px] border border-white/10 bg-[#0b0b10]/96 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-white/30">Explore</div>
                    <div className="text-lg font-bold tracking-tight text-white">Quick navigation</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Close explore"
                    onClick={() => setIsExploreOpen(false)}
                    className="h-10 w-10 rounded-2xl border border-white/10 bg-white/5 text-white/30 transition-all hover:border-white/20 hover:text-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>

                <div className="relative">
                  <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/20">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                  </div>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search sections..."
                    className="w-full rounded-2xl border border-white/10 bg-black/40 py-4 pl-12 pr-4 text-sm font-bold tracking-tight text-white placeholder:text-white/20 focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="space-y-3">
                  {exploreLinks.length > 0 ? exploreLinks.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => {
                        setIsExploreOpen(false);
                        setSearchQuery('');
                      }}
                      className="block rounded-2xl border border-white/5 bg-white/3 px-4 py-4 transition-all hover:border-accent/30 hover:bg-accent/6"
                    >
                      <div className="text-sm font-bold tracking-tight text-white">{item.label}</div>
                      <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white/25">{item.description}</div>
                    </Link>
                  )) : (
                    <div className="rounded-2xl border border-white/5 bg-white/3 px-4 py-6 text-center text-xs font-bold uppercase tracking-[0.25em] text-white/25">
                      No matching sections
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Footer Nav */}
      <div className="flex flex-col gap-6 items-center">
                <NotificationInbox placement="right-end" />
        <div className="h-12 w-12 rounded-full border-2 border-accent/30 p-0.5 group cursor-pointer transition-transform hover:scale-110">
          <div className="h-full w-full rounded-full bg-linear-to-tr from-accent-secondary/40 to-accent/40 flex items-center justify-center text-xs font-bold">
            KP
          </div>
        </div>
        <div className="text-white/20 hover:text-white transition-colors cursor-pointer">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </div>
      </div>
    </aside>
  );
}
