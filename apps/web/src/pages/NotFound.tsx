import { Link } from "react-router";
import { Header, Page } from "../ui";

export default function NotFound() {
  return (
    <>
      <Header title="Page not found" />
      <Page>
        <p className="text-slate-600">
          That page doesn't exist. <Link to="/" className="font-semibold text-brand-700 underline">Go home</Link>
        </p>
      </Page>
    </>
  );
}
