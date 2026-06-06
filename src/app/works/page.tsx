"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Work } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api";
import { useIdentity } from "@/lib/use-identity";
import { RequireWallet } from "@/components/require-wallet";
import { WorkStatusPill } from "@/components/status-pill";
import { Address } from "@/components/data";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/spinner";

export default function WorksPage() {
  return (
    <RequireWallet>
      <WorksGallery />
    </RequireWallet>
  );
}

function WorksGallery() {
  const { address } = useIdentity();
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { works } = await apiGet<{ works: Work[] }>("/api/works");
      setWorks(works);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load works");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Show the connected user's own works first (producer landing).
  const sorted = [...works].sort((a, b) => {
    const mine = (w: Work) =>
      w.requester_addr.toLowerCase() === address?.toLowerCase() ? 0 : 1;
    return mine(a) - mine(b);
  });

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <span className="rf-eyebrow">Gallery</span>
          <h1 className="rf-display mt-2 text-3xl">Works</h1>
          <p className="mt-1 text-sm text-t3">
            Collaborative creative works and their bounty boards.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + Create new work
        </button>
      </div>

      <hr className="rf-prism-rule my-6" />

      {loading ? (
        <div className="flex items-center gap-2 text-t3">
          <Spinner /> Loading works…
        </div>
      ) : error ? (
        <div className="card bg-danger-subtle text-danger">{error}</div>
      ) : sorted.length === 0 ? (
        <div className="card text-center text-t3">
          No works yet. Create the first one to deploy its asset contract.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((w) => (
            <WorkCard
              key={w.id}
              work={w}
              mine={w.requester_addr.toLowerCase() === address?.toLowerCase()}
            />
          ))}
        </div>
      )}

      <CreateWorkModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        requesterAddr={address ?? ""}
      />
    </div>
  );
}

function WorkCard({ work, mine }: { work: Work; mine: boolean }) {
  return (
    <Link
      href={`/work/${work.id}`}
      className="card group flex flex-col transition-shadow hover:shadow-glow-accent"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="rf-display text-lg leading-tight text-t1">{work.title}</h2>
        <WorkStatusPill status={work.status} />
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-t3">
        {work.description || "No description."}
      </p>
      <div className="mt-4 flex items-center justify-between text-xs">
        <Address value={work.requester_addr} />
        {mine && <span className="text-accent">you</span>}
      </div>
    </Link>
  );
}

function CreateWorkModal({
  open,
  onClose,
  requesterAddr,
}: {
  open: boolean;
  onClose: () => void;
  requesterAddr: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { work } = await apiPost<{ work: Work }>("/api/works", {
        title: title.trim(),
        description: description.trim() || undefined,
        requesterAddr,
      });
      // Created + asset contract deployed on-chain → go straight to its board.
      router.push(`/work/${work.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create work");
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Create new work">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Pixel Quest (video game)"
            disabled={submitting}
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="description">
            Description <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id="description"
            className="input min-h-[80px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this work?"
            disabled={submitting}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="rounded-md border border-[color:var(--border-subtle)] bg-surface-raised p-3 text-xs text-t3">
          Creating a work deploys its asset contract on Sepolia. This takes ~10–30s.
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting || !title.trim()}>
            {submitting ? (
              <>
                <Spinner /> Deploying asset contract…
              </>
            ) : (
              "Create work"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
