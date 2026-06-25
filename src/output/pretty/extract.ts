import pc from "picocolors";

interface ExtractCategory {
  primary?: string;
  secondary?: string;
}

interface ExtractItem {
  url: string;
  status: "success" | "failed";
  title?: string;
  category?: ExtractCategory;
  page_structure?: ExtractCategory;
  time_published?: string;
  full_content?: string;
  highlights?: string[];
  error_message?: string;
}

interface ExtractResponse {
  items?: ExtractItem[];
  results?: ExtractItem[];
}

const MAX_CONTENT = 500;

export function renderExtract(data: any): string {
  const items: ExtractItem[] =
    (data as ExtractResponse)?.items ??
    (data as ExtractResponse)?.results ??
    [];

  if (!items.length) return pc.dim("No results.");

  return items
    .map((item) => {
      const lines: string[] = [];

      // Bold URL header
      lines.push(pc.bold(item.url));

      if (item.status === "failed") {
        lines.push(pc.red(`  failed: ${item.error_message ?? "(unknown error)"}`));
      } else {
        // Dim metadata line: category / page_structure
        const catPrimary = item.category?.primary;
        const structPrimary = item.page_structure?.primary;
        if (catPrimary || structPrimary) {
          const parts = [catPrimary, structPrimary].filter(Boolean).join(" / ");
          lines.push(pc.dim(`  ${parts}`));
        }

        // Title
        if (item.title) lines.push(`  ${item.title}`);

        // Snippet: prefer joined highlights, else truncated full_content
        if (item.highlights && item.highlights.length > 0) {
          lines.push(`  ${item.highlights.join(" ")}`);
        } else if (item.full_content) {
          const raw = item.full_content;
          const snippet =
            raw.length > MAX_CONTENT ? raw.slice(0, MAX_CONTENT) + "…" : raw;
          lines.push(`  ${snippet}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
