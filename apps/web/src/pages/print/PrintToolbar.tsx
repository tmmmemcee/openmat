import { Button } from "../../ui";

/** On-screen controls for print pages; hidden on paper. */
export function PrintToolbar({ title, count, children }: { title: string; count: string; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 print:hidden">
      <div>
        <div className="font-bold">{title}</div>
        <div className="text-sm text-slate-600">{count}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {children}
        <Button onClick={() => window.print()}>🖨 Print</Button>
      </div>
    </div>
  );
}
