export const memberTransferRequestSchemas = [
  {
    key: "member-transfer-requests",
    collection: "member_transfer_requests",
    fields: {
      id: "uuid",
      requester_member_id: "uuid",
      target_email: "string",
      target_member_id: "uuid",
      token: "string",
      status: "string",
      expires_at: "timestamp",
      created_at: "timestamp",
      responded_at: "timestamp",
      completed_at: "timestamp",
    },
  },
];
