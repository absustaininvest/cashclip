import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreditAuditTable, type CreditAuditRow } from "./Admin";

const baseRow: CreditAuditRow = {
  id: "row-1",
  userId: "user-1",
  username: "jane",
  email: "jane@example.com",
  amount: "5.00",
  description: "Goodwill credit",
  actorUserId: "admin-1",
  actorUsername: "alice",
  createdAt: new Date("2026-06-01T10:00:00Z").toISOString(),
};

function renderRow(overrides: Partial<CreditAuditRow>): HTMLElement[] {
  const row = { ...baseRow, ...overrides };
  render(<CreditAuditTable rows={[row]} />);
  return screen.getAllByRole("cell");
}

describe("CreditAuditTable — 'Issued by' cell", () => {
  it("shows the acting admin's username when present", () => {
    const cells = renderRow({ actorUsername: "alice", actorUserId: "admin-1" });
    // Columns: User, Amount, Reason, Issued by, When
    expect(cells[3]).toHaveTextContent("alice");
  });

  it("falls back to the actor's id when username is null", () => {
    const cells = renderRow({ actorUsername: null, actorUserId: "admin-1" });
    expect(cells[3]).toHaveTextContent("admin-1");
  });

  it('shows "—" when both username and id are null', () => {
    const cells = renderRow({ actorUsername: null, actorUserId: null });
    expect(cells[3]).toHaveTextContent("—");
  });
});
