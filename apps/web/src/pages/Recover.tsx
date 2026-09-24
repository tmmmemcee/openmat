import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Button, Card, ErrorBox, Field, Header, Input, Notice, Page } from "../ui";

/** Lost director link: email fresh links for every tournament under this email. */
export default function Recover() {
  const [email, setEmail] = useState("");
  const send = useMutation({ mutationFn: () => api("/recover", { method: "POST", body: { email } }) });
  return (
    <>
      <Header title="Lost your director link?" />
      <Page className="max-w-xl">
        <Card>
          {send.isSuccess ? (
            <Notice tone="green">
              If <strong>{email}</strong> is the director email on any tournaments, we just sent new director links there. Check your inbox
              (and spam folder).
            </Notice>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate();
              }}
            >
              <p className="text-sm text-slate-600">
                Enter the email you gave when you set up the tournament. We'll email you a new link for each of your tournaments. Your old
                links keep working too.
              </p>
              <Field label="Director email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </Field>
              <ErrorBox error={send.error} />
              <Button type="submit" disabled={send.isPending || !email}>
                {send.isPending ? "Sending…" : "Email me my links"}
              </Button>
              <p className="text-xs text-slate-500">
                Didn't give an email when you set it up? Contact whoever runs this site; they can issue you a new link.
              </p>
            </form>
          )}
        </Card>
      </Page>
    </>
  );
}
