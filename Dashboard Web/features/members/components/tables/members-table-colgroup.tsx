import {
  MEMBER_ACTIONS_COL_WIDTH,
  MEMBER_NAME_COL_MIN_WIDTH,
  MEMBER_ROLE_COL_MIN_WIDTH,
  MEMBER_SELECT_COL_WIDTH,
  memberTableColWidth,
} from "@/features/members/hooks/use-auto-hidden-table-columns"

type MembersTableColGroupProps = {
  visibleColKeys: readonly string[]
  showSelectColumn?: boolean
  showActionsColumn?: boolean
}

export function MembersTableColGroup({
  visibleColKeys,
  showSelectColumn = true,
  showActionsColumn = true,
}: MembersTableColGroupProps) {
  return (
    <colgroup>
      {showSelectColumn && <col style={{ width: MEMBER_SELECT_COL_WIDTH }} />}
      <col style={{ width: MEMBER_NAME_COL_MIN_WIDTH, minWidth: MEMBER_NAME_COL_MIN_WIDTH }} />
      {visibleColKeys.map((key) => (
        <col
          key={key}
          style={{
            width: memberTableColWidth(key),
            minWidth: key === "role" ? MEMBER_ROLE_COL_MIN_WIDTH : undefined,
          }}
        />
      ))}
      {showActionsColumn && <col style={{ width: MEMBER_ACTIONS_COL_WIDTH }} />}
    </colgroup>
  )
}
