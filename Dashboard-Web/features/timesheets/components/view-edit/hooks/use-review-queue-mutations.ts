"use client"

import { reviewAssignment } from "@/features/tasks/api/task-assignments-api"

interface UseReviewQueueMutationsProps {
  canReviewAssignments: boolean
}

export function useReviewQueueMutations({ canReviewAssignments }: UseReviewQueueMutationsProps) {
  async function submitReview(
    assignmentId: string,
    decision: "approve" | "reject",
    notes: string,
  ): Promise<{ assignmentStatus: string; taskStatus: string }> {
    if (!canReviewAssignments) {
      throw new Error("You do not have permission to review assignments.")
    }
    const result = await reviewAssignment(assignmentId, decision, notes)
    if (!result) {
      throw new Error("Failed to review assignment.")
    }
    return result
  }

  return { submitReview }
}
