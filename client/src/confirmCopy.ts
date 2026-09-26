import type { ConfirmOptions } from "./components/ConfirmProvider";

// Wording for the app's confirmation popups, in one place so the same
// action reads the same everywhere (Circles list vs Circle page, discovery
// card vs game page…). Each returns options for useConfirm().

export function joinCircleConfirm(c: { name: string; joinMode?: string; members?: number }): ConfirmOptions {
  if (c.joinMode === "approval") {
    return {
      title: `Ask to join ${c.name}?`,
      message: "The organiser will review your request. You'll get a notification when they respond.",
      confirmLabel: "Send request",
    };
  }
  return {
    title: `Join ${c.name}?`,
    message: "You'll see its plans and chat, get updates when something's planned, and members will see you've joined. You can leave any time.",
    confirmLabel: "Join Circle",
  };
}

export function leaveCircleConfirm(name: string): ConfirmOptions {
  return {
    title: `Leave ${name}?`,
    message: "You'll stop getting its updates and lose access to members-only plans and chat. You can join again later.",
    confirmLabel: "Leave Circle",
    cancelLabel: "Stay",
    tone: "danger",
  };
}

export function joinGameConfirm(g: { title: string; when?: string; priceCents?: number | null }): ConfirmOptions {
  const paid = !!g.priceCents;
  return {
    title: `Join ${g.title}?`,
    message: `${g.when ? `${g.when}. ` : ""}${paid ? `It's €${((g.priceCents ?? 0) / 100).toFixed(2)} — you'll pay on the next screen.` : "It's free — the host and other players will see you're coming."}`,
    confirmLabel: paid ? "Continue to payment" : "Confirm I'm in",
  };
}

export function joinWaitlistConfirm(title: string): ConfirmOptions {
  return {
    title: `Join the waitlist for ${title}?`,
    message: "It's full right now. If a spot opens up you'll be offered it, and you'll have a limited time to claim it.",
    confirmLabel: "Join waitlist",
  };
}

export function leaveWaitlistConfirm(title: string): ConfirmOptions {
  return {
    title: `Leave the waitlist for ${title}?`,
    message: "You'll lose your place in the queue. You can rejoin later, but at the back.",
    confirmLabel: "Leave waitlist",
    cancelLabel: "Stay on it",
    tone: "danger",
  };
}

export function leaveGameConfirm(title: string, paid: boolean): ConfirmOptions {
  return {
    title: `Leave ${title}?`,
    message: paid
      ? "You'll lose your spot and it isn't refunded automatically — contact the host if you paid."
      : "You'll lose your spot, and the host will see you've dropped out.",
    confirmLabel: "Leave session",
    cancelLabel: "Stay in",
    tone: "danger",
  };
}

export function withdrawInterestConfirm(activity: string): ConfirmOptions {
  return {
    title: `Remove your interest in ${activity}?`,
    message: "You won't be counted toward this request or told when something matching it starts.",
    confirmLabel: "Remove",
    cancelLabel: "Keep it",
    tone: "danger",
  };
}

export function declineInviteConfirm(what: string): ConfirmOptions {
  return {
    title: `Decline the invitation to ${what}?`,
    message: "Whoever invited you will see you've declined.",
    confirmLabel: "Decline",
    tone: "danger",
  };
}
