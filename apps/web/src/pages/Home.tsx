import { Link } from "react-router";
import { useStartDemo } from "../lib/demo";
import { Button, Card, ErrorBox, Header, Page } from "../ui";

const features = [
  ["Youth scratch-weight groups", "Groups kids of similar weight and age automatically. Move a kid up with one tap, never down."],
  ["Brackets your way", "Round robins, double elimination with wrestlebacks, or official weight classes for high school."],
  ["Smart mat schedule", "Every kid gets their rest between matches. Mats stay busy."],
  ["Live on deck / in the hole", "Parents see where and when their kid wrestles next and get a heads-up."],
  ["Easy table scoring", "Tap to score on a phone or tablet. Fix mistakes without losing history."],
  ["Free and open source", "No paywall on results or alerts. MIT licensed."],
];

const demos = [
  {
    kind: "youth" as const,
    title: "Youth tournament",
    text: "51 kids from four clubs, grouped by weight at weigh-ins into round robins on 3 mats. Mid-morning, with matches live.",
  },
  {
    kind: "high-school" as const,
    title: "High school invitational",
    text: "63 wrestlers in six weight classes, seeded double-elimination brackets on 4 mats, team scores adding up.",
  },
];

export default function Home() {
  const start = useStartDemo();
  return (
    <>
      <Header />
      <section className="bg-brand-900 pb-16 text-white">
        <div className="mx-auto max-w-6xl px-4 pt-8">
          <h1 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-5xl">Run your wrestling tournament without the headaches.</h1>
          <p className="mt-4 max-w-xl text-lg text-brand-100">
            Registration, weigh-ins, brackets, mat schedules and live results, in one place. No software to install and nothing
            technical to set up.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/new" className="inline-flex rounded-lg bg-amber-400 px-6 py-3.5 text-base font-bold text-slate-900 hover:bg-amber-300">
              Set up a tournament →
            </Link>
            <Link to="/tournaments" className="inline-flex rounded-lg px-6 py-3.5 text-base font-bold text-white ring-1 ring-white/40 hover:bg-white/10">
              Find a tournament
            </Link>
            <a href="#demo" className="inline-flex rounded-lg px-6 py-3.5 text-base font-bold text-white ring-1 ring-white/40 hover:bg-white/10">
              Try the live demo
            </a>
          </div>
          <p className="mt-4 text-sm text-brand-100">
            Running a tournament and lost your link?{" "}
            <Link to="/recover" className="font-semibold text-white underline">
              Get it back
            </Link>
          </p>
        </div>
      </section>
      <Page className="-mt-10 space-y-10">
        <section id="demo" className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-2xl font-extrabold">Try it with a real tournament</h2>
          <p className="mt-1 max-w-2xl text-slate-600">
            Get your own demo tournament, already in progress, and run it as the director. Score a match at a table, move bouts between mats, follow a wrestler
            like a parent would. It takes a few seconds to set up, nobody else sees it, and it's deleted after a day.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {demos.map((d) => (
              <div key={d.kind} className="flex flex-col justify-between gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div>
                  <h3 className="font-bold">{d.title}</h3>
                  <p className="text-sm text-slate-600">{d.text}</p>
                </div>
                <Button disabled={start.isPending} onClick={() => start.mutate(d.kind)} className="self-start">
                  {start.isPending && start.variables === d.kind ? "Setting up your tournament…" : "Start this demo →"}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <ErrorBox error={start.error} />
          </div>
        </section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, text]) => (
            <Card key={title}>
              <h2 className="font-bold">{title}</h2>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </Card>
          ))}
        </div>
      </Page>
    </>
  );
}
