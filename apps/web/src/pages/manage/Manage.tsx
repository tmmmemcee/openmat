import { Link, NavLink, useParams } from "react-router";
import { DemoGuide } from "../../components/DemoGuide";
import { useEvent } from "../../lib/hooks";
import { formatDate, place } from "../../lib/format";
import { ErrorBox, Header, Notice, Page, Spinner, cx } from "../../ui";
import BracketsTab from "./BracketsTab";
import Groups from "./Groups";
import LiveTab from "./LiveTab";
import Overview from "./Overview";
import Wrestlers from "./Wrestlers";

export default function Manage() {
  const { slug = "", tab = "overview" } = useParams();
  const event = useEvent(slug);

  if (event.isLoading) return <Spinner />;
  if (event.error || !event.data) {
    return (
      <Page>
        <ErrorBox error={event.error} />
      </Page>
    );
  }
  const ev = event.data;
  if (ev.access?.role !== "director") {
    return (
      <>
        <Header title={ev.name} />
        <Page className="max-w-xl">
          <Notice tone="amber">
            This page is for the tournament director. Open the director link you saved when the tournament was created.{" "}
            <Link to="/recover" className="font-semibold underline">
              Lost it?
            </Link>
          </Notice>
        </Page>
      </>
    );
  }

  const tabs = [
    ["overview", "Overview"],
    ["wrestlers", "Wrestlers"],
    ...(ev.format === "madison" ? [["groups", "Groups"]] : []),
    ["brackets", "Brackets & mats"],
    ["live", "Live"],
  ] as [string, string][];

  return (
    <>
      <Header
        title={ev.name}
        subtitle={[formatDate(ev.startDate), place(ev)].filter(Boolean).join(" · ")}
        right={
          <a href={`/e/${slug}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-amber-300 hover:underline">
            Public page ↗
          </a>
        }
      />
      {ev.isDemo && <DemoGuide event={ev} />}
      <nav className="sticky top-0 z-10 border-b border-slate-200 bg-white" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {tabs.map(([key, label]) => (
            <NavLink
              key={key}
              to={`/e/${slug}/manage/${key}`}
              className={cx(
                "border-b-2 px-3 py-3 text-sm font-semibold whitespace-nowrap",
                tab === key ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900",
              )}
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Page>
        {tab === "overview" && <Overview event={ev} />}
        {tab === "wrestlers" && <Wrestlers event={ev} />}
        {tab === "groups" && ev.format === "madison" && <Groups event={ev} />}
        {tab === "brackets" && <BracketsTab event={ev} />}
        {tab === "live" && <LiveTab event={ev} />}
      </Page>
    </>
  );
}
