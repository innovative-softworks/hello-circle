import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCirclePolls, voteOnCirclePollOption } from "../api";
import { dateLabel } from "../euro";
import { colors, radius } from "../theme";
import type { CirclePoll, NeedsAttentionItem } from "../types";
import { Button, LoadErrorState, Modal, RowSkeleton } from "./ui";

// Vote on a Circle date poll without leaving My Life: the "Vote" action of an
// open_poll needs-attention item opens this instead of navigating to the
// Circle. Same multi-select toggle as the Circle's own polls panel (each
// click toggles that option server-side), so nothing is saved on "Done".

/** open_poll items carry the poll id as sourceId and link to /circles/:id. */
export function pollTargetOf(item: NeedsAttentionItem): { circleId: string; pollId: string } | null {
  if (item.actionType !== "open_poll") return null;
  const m = item.actionUrl.match(/^\/circles\/([^/?#]+)/);
  return m ? { circleId: decodeURIComponent(m[1]), pollId: item.sourceId } : null;
}

export function PollVoteModal({ item, onClose }: { item: NeedsAttentionItem | null; onClose: (voted: boolean) => void }) {
  const target = item ? pollTargetOf(item) : null;
  // undefined = loading, null = gone (closed and removed, or no longer a member).
  const [poll, setPoll] = useState<CirclePoll | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyOption, setBusyOption] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const voted = useRef(false);

  const load = () => {
    if (!target) return;
    setLoadFailed(false);
    fetchCirclePolls(target.circleId)
      .then((polls) => setPoll(polls.find((p) => p.id === target.pollId) ?? null))
      .catch(() => setLoadFailed(true));
  };

  useEffect(() => {
    setPoll(undefined);
    setError(null);
    voted.current = false;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.circleId, target?.pollId]);

  const vote = async (optionId: number) => {
    if (!target || !poll || busyOption !== null) return;
    setBusyOption(optionId);
    setError(null);
    try {
      await voteOnCirclePollOption(target.circleId, poll.id, optionId);
      voted.current = true;
      const polls = await fetchCirclePolls(target.circleId);
      setPoll(polls.find((p) => p.id === poll.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your vote. Try again.");
    } finally {
      setBusyOption(null);
    }
  };

  const close = () => onClose(voted.current);
  const totalVotes = poll ? poll.options.reduce((n, o) => n + o.voteCount, 0) : 0;
  const myVotes = poll ? poll.options.filter((o) => o.votedByMe).length : 0;

  return (
    <Modal
      open={!!item}
      onClose={close}
      title={poll?.question ?? "Vote"}
      subtitle={item?.title}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {target ? (
            <Link className="mlx-link" to={`/circles/${target.circleId}`} onClick={close}>
              Open the Circle
            </Link>
          ) : (
            <span />
          )}
          <Button onClick={close}>Done</Button>
        </div>
      }
    >
      {loadFailed ? (
        <LoadErrorState title="Couldn't load this poll" onRetry={load} />
      ) : poll === undefined ? (
        <RowSkeleton />
      ) : poll === null ? (
        <p style={{ margin: 0, fontSize: 14, color: colors.muted }}>This poll isn't available any more. It may have been removed by the organiser.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 12px", fontSize: 13.5, color: colors.muted }}>
            {poll.status === "open" ? "Pick every option that works for you. Tap again to remove a vote." : "This poll is closed."}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {poll.options.map((o) => {
              const pct = totalVotes ? Math.round((o.voteCount / totalVotes) * 100) : 0;
              const fill = o.votedByMe ? "rgba(46, 125, 80, 0.22)" : "rgba(46, 125, 80, 0.12)";
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => poll.status === "open" && vote(o.id)}
                  disabled={poll.status !== "open" || busyOption !== null}
                  aria-pressed={o.votedByMe}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    textAlign: "left",
                    border: `1px solid ${o.votedByMe ? colors.green : colors.border}`,
                    background: `linear-gradient(90deg, ${fill} ${pct}%, ${colors.surface} ${pct}%)`,
                    borderRadius: radius.control,
                    padding: "10px 12px",
                    minHeight: 48,
                    cursor: poll.status === "open" ? "pointer" : "default",
                    color: colors.text,
                    opacity: busyOption !== null && busyOption !== o.id ? 0.7 : 1,
                  }}
                >
                  <span style={{ fontSize: 14 }}>
                    {dateLabel(o.date)}
                    {o.time ? ` · ${o.time}` : ""}
                  </span>
                  <span style={{ fontSize: 12, color: colors.muted, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {o.votedByMe && "✓ "}
                    {o.voteCount} vote{o.voteCount === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
          {error && (
            <p role="alert" style={{ margin: "10px 0 0", fontSize: 13, color: colors.danger }}>
              {error}
            </p>
          )}
          {myVotes > 0 && !error && (
            <p aria-live="polite" style={{ margin: "10px 0 0", fontSize: 13, color: colors.greenText, fontWeight: 600 }}>
              Your vote is saved.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
