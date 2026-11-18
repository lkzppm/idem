import { LocaleSwitch } from "./locale-switch";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

/**
 * The site header: 64 px of translucent material and a 1 px hairline (65 px in all, what the
 * sandbox and the docs' sticky rails subtract) that pages scroll under. The logo and the tabs
 * (with the tab story, `nav-links.tsx`) on the left; the language and theme switches on the right.
 */
export function SiteHeader() {
  return (
    <header className="site-header material sticky top-0 z-50 border-b border-line">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <NavLinks />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
