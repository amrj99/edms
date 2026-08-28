/**
 * StorageLink — DEBT-010 F8. Drop-in replacement for `<a href={fileUrl}>` links that
 * point at private storage. Renders a button styled like the old link, but routes the
 * click through the authenticated open/download helpers so an internal storage URL is
 * NEVER navigated to without a view-token. On failure it shows a toast (UI layer) and
 * never falls back to the raw URL.
 */
import { openStorageFile, downloadStorageFile } from "@/lib/storage-access";
import { useToast } from "@/hooks/use-toast";

interface StorageLinkProps {
  fileUrl: string;
  /** When true, download with a filename instead of opening in a tab. */
  download?: boolean;
  filename?: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

export function StorageLink({ fileUrl, download, filename, className, title, children }: StorageLinkProps) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        const action = download
          ? downloadStorageFile(fileUrl, filename ?? "download")
          : openStorageFile(fileUrl);
        action.catch(() =>
          toast({ title: "Could not open file. Please try again.", variant: "destructive" }),
        );
      }}
    >
      {children}
    </button>
  );
}
