'use client';

import {useEffect, useMemo, useState} from 'react';

type LinkItem = {
  href: string;
  label: string;
};

type DesktopNavProps = {
  links: LinkItem[];
};

export function DesktopNav({links}: DesktopNavProps) {
  const [activeHref, setActiveHref] = useState<string>('');

  const sectionIds = useMemo(
    () =>
      links
        .map((link) => link.href.replace('#', '').trim())
        .filter(Boolean),
    [links]
  );

  useEffect(() => {
    const lastHref = links[links.length - 1]?.href;

    const resolveActiveFromScroll = () => {
      const nearPageBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;

      if (nearPageBottom && lastHref) {
        setActiveHref(lastHref);
        return;
      }

      const offset = 140;
      let current = sectionIds[0] ?? '';

      for (const id of sectionIds) {
        const section = document.getElementById(id);
        if (!section) continue;
        if (section.getBoundingClientRect().top <= offset) {
          current = id;
        }
      }

      if (current) setActiveHref(`#${current}`);
    };

    const setFromHash = () => {
      if (!window.location.hash) return;
      const hash = window.location.hash;
      if (links.some((link) => link.href === hash)) {
        setActiveHref(hash);
      }
    };

    setFromHash();
    resolveActiveFromScroll();

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]?.target?.id) {
          setActiveHref(`#${visible[0].target.id}`);
        } else {
          resolveActiveFromScroll();
        }
      },
      {
        root: null,
        rootMargin: '-22% 0px -68% 0px',
        threshold: [0.01, 0.15, 0.4]
      }
    );

    for (const id of sectionIds) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }

    window.addEventListener('scroll', resolveActiveFromScroll, {passive: true});
    window.addEventListener('hashchange', setFromHash);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', resolveActiveFromScroll);
      window.removeEventListener('hashchange', setFromHash);
    };
  }, [links, sectionIds]);

  return (
    <nav className="top-nav" aria-label="Primary">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={activeHref === link.href ? 'is-active' : undefined}
          aria-current={activeHref === link.href ? 'true' : undefined}
          onClick={() => setActiveHref(link.href)}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
