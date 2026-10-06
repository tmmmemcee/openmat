import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import { coachLink, setTeamToken } from "../../lib/teamToken";
import { Button, Card, CopyButton, ErrorBox, Field, Header, Input, Notice, Page } from "../../ui";

/** A coach saves their team once and reuses the roster for every event. */
export default function NewTeam() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ id: string; name: string; coachToken: string }>("/teams", { method: "POST", body: { name, coachEmail: email || null } }),
    onSuccess: (team) => setTeamToken(team.id, team.coachToken),
  });

  if (create.data) {
    const link = coachLink(create.data.id, create.data.coachToken);
    return (
      <>
        <Header title={create.data.name} subtitle="Your team is saved" />
        <Page className="max-w-xl space-y-4">
          <Card className="space-y-3">
            <h2 className="font-bold">Your coach link</h2>
            <p className="text-sm text-slate-600">
              This link is the key to your roster. There's no password: anyone with it can see and change your roster, so share it only with
              your other coaches. {email && "We've also emailed it to you."}
            </p>
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 font-mono text-xs break-all ring-1 ring-slate-200">
              <span className="flex-1">{link}</span>
              <CopyButton text={link} />
            </div>
          </Card>
          <Link to={`/t/${create.data.id}`}>
            <Button size="lg" className="w-full">
              Add your wrestlers →
            </Button>
          </Link>
        </Page>
      </>
    );
  }

  return (
    <>
      <Header title="Save your team" subtitle="For coaches" />
      <Page className="max-w-xl space-y-4">
        <Notice>
          Keep your roster in one place: names, birth years, latest weights and experience. Then register your kids for any OpenMat tournament
          or meet in a few taps, without typing them in again.
        </Notice>
        <Card className="space-y-3">
          <Field label="Team or club name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Springfield Youth Wrestling" />
          </Field>
          <Field label="Coach email" hint="Optional, but recommended: we'll email you the coach link so you don't lose it.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorBox error={create.error} />
          <Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Saving…" : "Save team"}
          </Button>
        </Card>
      </Page>
    </>
  );
}
