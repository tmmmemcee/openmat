import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { BracketView } from "../../components/BracketView";
import { formatDate } from "../../lib/format";
import { useBrackets, useEvent } from "../../lib/hooks";
import { ErrorBox, Spinner } from "../../ui";
import { PrintToolbar } from "./PrintToolbar";

/** Usable landscape letter page at 0.35in margins, in CSS pixels. */
const PAGE = { width: (11 - 0.7) * 96, height: (8.5 - 0.7) * 96 - 8 };

/** Shrinks its content (never enlarges) so it fits on one printed page. */
function FitToPage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.zoom = "1";
      const z = Math.min(1, PAGE.width / el.scrollWidth, PAGE.height / el.scrollHeight);
      el.style.zoom = String(z);
      setZoom(z);
    };
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(el.firstElementChild ?? el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ zoom, width: "max-content", maxWidth: zoom < 1 ? undefined : "100%" }}>
      {children}
    </div>
  );
}

/** Printable brackets: one per page, landscape. ?b=<id> for just one. */
export default function PrintBrackets() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const event = useEvent(slug);
  const data = useBrackets(slug);
  const wrestlers = useMemo(() => new Map((data.data?.wrestlers ?? []).map((w) => [w.id, w])), [data.data]);
  if (event.isLoading || data.isLoading) return <Spinner />;
  if (!event.data || !data.data) return <ErrorBox error={event.error ?? data.error} />;
  const only = params.get("b");
  const list = data.data.brackets.filter((b) => !only || b.id === only);
  return (
    <div className="bg-white">
      <style>{"@page { size: letter landscape; margin: 0.35in; }"}</style>
      <PrintToolbar title={`Brackets · ${event.data.name}`} count={`${list.length} bracket${list.length === 1 ? "" : "s"}, one per page`} />
      {list.map((b) => (
        <section key={b.id} className="mx-auto max-w-[10.3in] px-4 py-4 break-after-page print:px-0 print:py-0">
          <FitToPage>
          <header className="mb-3 flex items-end justify-between border-b-2 border-slate-900 pb-1">
            <h1 className="text-xl font-black">{b.name}</h1>
            <div className="text-right text-xs text-slate-600">
              {event.data.name} · {formatDate(event.data.startDate)}
            </div>
          </header>
          <BracketView bracket={b} wrestlers={wrestlers} print />
          </FitToPage>
        </section>
      ))}
    </div>
  );
}
