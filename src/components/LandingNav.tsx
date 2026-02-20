'use client';

import {useEffect, useMemo, useState} from 'react';

type NavItem = {
  href: '#services' | '#cases' | '#process' | '#contact';
  label: string;
  desktopTestId: string;
};

type LandingNavProps = {
  items: NavItem[];
};

export function LandingNav({items}: LandingNavProps) {
  const [activeHref, setActiveHref] = useState<NavItem['href']>('#services');

  const sectionIds = useMemo(
    () => items.map((item) => item.href.replace('#', '')),
    [items]
  );

  useEffect(() => {
    const setFromHash = () => {
      const hash = window.location.hash as NavItem['href'];
      if (items.some((item) => item.href === hash)) {
        setActiveHref(hash);
      }
    };

    const resolveFromScroll = () => {
      const nearPageBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 12;
      const lastHref = items[items.length - 1]?.href;

      if (nearPageBottom && lastHref) {
        setActiveHref(lastHref);
        return;
      }

      let current = items[0]?.href ?? '#services';
      const offset = 140;

      for (const id of sectionIds) {
        const section = document.getElementById(id);
        if (!section) {
          continue;
        }

        if (section.getBoundingClientRect().top <= offset) {
          current = `#${id}` as NavItem['href'];
        }
      }

      setActiveHref(current);
    };

    setFromHash();
    resolveFromScroll();

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        const firstVisibleId = visible[0]?.target?.id;
        if (firstVisibleId) {
          setActiveHref(`#${firstVisibleId}` as NavItem['href']);
          return;
        }

        resolveFromScroll();
      },
      {
        root: null,
        rootMargin: '-30% 0px -55% 0px',
        threshold: [0.05, 0.2, 0.4]
      }
    );

    for (const id of sectionIds) {
      const section = document.getElementById(id);
      if (section) {
        observer.observe(section);
      }
    }

    window.addEventListener('scroll', resolveFromScroll, {passive: true});
    window.addEventListener('hashchange', setFromHash);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', resolveFromScroll);
      window.removeEventListener('hashchange', setFromHash);
    };
  }, [items, sectionIds]);

  return (
    <div className="navbar-center hidden lg:flex">
      <ul className="menu menu-horizontal landing-nav-menu rounded-full bg-base-200/70 px-2 py-1 text-sm font-bold text-base-content">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              data-testid={item.desktopTestId}
              className={activeHref === item.href ? 'active-section' : undefined}
              aria-current={activeHref === item.href ? 'page' : undefined}
              onClick={() => setActiveHref(item.href)}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
