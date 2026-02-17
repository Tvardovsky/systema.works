'use client';

import {useState} from 'react';
import {Dialog, IconButton} from '@radix-ui/themes';
import {HamburgerMenuIcon, Cross2Icon} from '@radix-ui/react-icons';

type LinkItem = {
  href: string;
  label: string;
};

type MobileNavProps = {
  links: LinkItem[];
};

export function MobileNav({links}: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <IconButton
          aria-label="Open navigation"
          variant="surface"
          radius="full"
          size="2"
          className="mobile-nav-trigger"
        >
          <HamburgerMenuIcon width="18" height="18" />
        </IconButton>
      </Dialog.Trigger>

      <Dialog.Content className="mobile-nav-content" size="2">
        <div className="mobile-nav-handle" aria-hidden />
        <div className="mobile-nav-head">
          <Dialog.Title className="mobile-nav-title">Navigation</Dialog.Title>
          <Dialog.Close>
            <IconButton aria-label="Close navigation" variant="ghost" radius="full" size="2">
              <Cross2Icon width="16" height="16" />
            </IconButton>
          </Dialog.Close>
        </div>
        <Dialog.Description className="mobile-nav-description">
          Choose a section to navigate through the page.
        </Dialog.Description>

        <nav className="mobile-nav-list" aria-label="Mobile primary">
          {links.map((link) => (
            <a href={link.href} key={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
      </Dialog.Content>
    </Dialog.Root>
  );
}
