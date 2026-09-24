import { Link } from "react-router";
import { Card, Header, Page } from "../ui";

const features = [
  ["Youth scratch-weight groups", "Groups kids of similar weight and age automatically. Move a kid up with one tap, never down."],
  ["Brackets your way", "Round robins, double elimination with wrestlebacks, or official weight classes for high school."],
  ["Smart mat schedule", "Every kid gets their rest between matches. Mats stay busy."],
  ["Live on deck / in the hole", "Parents see where and when their kid wrestles next and get a heads-up."],
  ["Easy table scoring", "Tap to score on a phone or tablet. Fix mistakes without losing history."],
  ["Free and open source", "No paywall on results or alerts. MIT licensed."],
];

export default function Home() {
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
          </div>
          <p className="mt-4 text-sm text-brand-100">
            Running a tournament and lost your link?{" "}
            <Link to="/recover" className="font-semibold text-white underline">
              Get it back
            </Link>
          </p>
        </div>
      </section>
      <Page className="-mt-10">
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
