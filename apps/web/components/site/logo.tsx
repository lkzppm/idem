import { IdemMarkSplit } from "@/components/brand/mark";

/**
 * The mark and the name. Inside a hovered `.logo-link` the harpoons slide past each other a little
 * (an exchange); in the header they also take part in the tab story (`tab-story.ts`).
 */
export function Logo({ className = "", wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <IdemMarkSplit size={26} />
      {wordmark && (
        <span className="logo-word font-display text-[17px] font-semibold tracking-[-0.03em]">idem</span>
      )}
    </span>
  );
}
